import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AuthConfig, AuthUser } from "../shared/types";
import type { AppEnv, SessionUser } from "./env";
import {
  base64UrlJson,
  githubOauthConfigured,
  hmacSign,
  hmacVerify,
  loadSettings,
  parseBase64UrlJson,
  randomToken,
  requestOrigin,
  sessionSecret,
} from "./utils";

const SESSION_COOKIE = "inav_session";
const STATE_COOKIE = "inav_oauth_state";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface SessionPayload extends SessionUser {
  iat: number;
  exp: number;
}

function cookieOptions(context: Context<AppEnv>) {
  return {
    path: "/",
    httpOnly: true,
    secure: new URL(context.req.url).protocol === "https:",
    sameSite: "Lax" as const,
  };
}

function toAuthUser(user: SessionUser): AuthUser {
  return {
    login: user.login,
    name: user.name,
    avatarUrl: user.avatarUrl,
    provider: user.provider,
  };
}

async function createSession(context: Context<AppEnv>, user: SessionUser): Promise<void> {
  const now = Date.now();
  const payload: SessionPayload = { ...user, iat: now, exp: now + SESSION_TTL_MS };
  const body = base64UrlJson(payload);
  const signature = await hmacSign(sessionSecret(context.env), body);
  setCookie(context, SESSION_COOKIE, `${body}.${signature}`, {
    ...cookieOptions(context),
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export async function readSession(context: Context<AppEnv>): Promise<SessionUser | null> {
  const raw = getCookie(context, SESSION_COOKIE);
  if (!raw) return null;
  const [body, signature] = raw.split(".");
  if (!body || !signature) return null;
  try {
    if (!(await hmacVerify(sessionSecret(context.env), body, signature))) return null;
  } catch {
    return null;
  }
  const payload = parseBase64UrlJson<SessionPayload>(body);
  if (!payload || !payload.login || !payload.exp || payload.exp < Date.now()) return null;
  return {
    login: payload.login,
    name: payload.name || payload.login,
    avatarUrl: payload.avatarUrl || "",
    provider: "github",
  };
}

export const requireAdmin: MiddlewareHandler<AppEnv> = async (context, next) => {
  const user = await readSession(context);
  if (!user) {
    return context.json({ error: "请先登录管理后台" }, 401);
  }
  context.set("user", user);
  await next();
};

function loginError(context: Context<AppEnv>, code: string) {
  return context.redirect(`/admin/login?error=${encodeURIComponent(code)}`, 302);
}

function allowedGitHubLogins(env: AppEnv["Bindings"], settingsValue: string): string[] {
  return `${env.ADMIN_GITHUB_LOGINS ?? ""},${settingsValue}`
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

const authRoutes = new Hono<AppEnv>();

authRoutes.get("/config", (context) => {
  const body: AuthConfig = {
    githubEnabled: githubOauthConfigured(context.env),
  };
  return context.json(body);
});

authRoutes.get("/me", async (context) => {
  const user = await readSession(context);
  return context.json({ user: user ? toAuthUser(user) : null });
});

authRoutes.get("/github", async (context) => {
  if (!githubOauthConfigured(context.env)) {
    return loginError(context, "oauth_not_configured");
  }
  const state = randomToken(24);
  setCookie(context, STATE_COOKIE, state, {
    ...cookieOptions(context),
    path: "/api/auth",
    maxAge: 10 * 60,
  });
  const callbackUrl =
    context.env.GITHUB_CALLBACK_URL || `${requestOrigin(context.req.raw, context.env)}/api/auth/github/callback`;
  const params = new URLSearchParams({
    client_id: context.env.GITHUB_CLIENT_ID!,
    redirect_uri: callbackUrl,
    scope: "read:user",
    state,
    allow_signup: "false",
  });
  return context.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`, 302);
});

authRoutes.get("/github/callback", async (context) => {
  const url = new URL(context.req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const storedState = getCookie(context, STATE_COOKIE);
  deleteCookie(context, STATE_COOKIE, { path: "/api/auth" });

  if (!githubOauthConfigured(context.env)) return loginError(context, "oauth_not_configured");
  if (!code || !state || !storedState || state !== storedState) return loginError(context, "state_mismatch");

  try {
    const callbackUrl =
      context.env.GITHUB_CALLBACK_URL || `${requestOrigin(context.req.raw, context.env)}/api/auth/github/callback`;
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "iNav/1.0",
      },
      body: new URLSearchParams({
        client_id: context.env.GITHUB_CLIENT_ID!,
        client_secret: context.env.GITHUB_CLIENT_SECRET!,
        code,
        redirect_uri: callbackUrl,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!tokenResponse.ok) return loginError(context, "oauth_failed");
    const tokenData = (await tokenResponse.json()) as { access_token?: string; error?: string };
    if (!tokenData.access_token) return loginError(context, "oauth_failed");

    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${tokenData.access_token}`,
        "User-Agent": "iNav/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!userResponse.ok) return loginError(context, "oauth_failed");
    const githubUser = (await userResponse.json()) as {
      login?: string;
      name?: string;
      avatar_url?: string;
    };
    if (!githubUser.login) return loginError(context, "oauth_failed");

    const settings = await loadSettings(context.env.DB);
    const allowed = allowedGitHubLogins(context.env, settings.githubAdmins);
    if (!allowed.includes(githubUser.login.toLowerCase())) {
      return loginError(context, "not_allowed");
    }

    await createSession(context, {
      login: githubUser.login,
      name: githubUser.name || githubUser.login,
      avatarUrl: githubUser.avatar_url || "",
      provider: "github",
    });
    return context.redirect("/admin", 302);
  } catch (error) {
    console.error("GitHub OAuth failed", error);
    return loginError(context, "oauth_failed");
  }
});

authRoutes.post("/logout", (context) => {
  deleteCookie(context, SESSION_COOKIE, { path: "/" });
  return context.json({ ok: true });
});

export default authRoutes;
