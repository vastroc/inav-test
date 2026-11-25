import { Hono } from "hono";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import adminRoutes from "./admin";
import authRoutes, { requireAdmin } from "./auth";
import type { AppEnv } from "./env";
import publicRoutes from "./public";
import { bumpDailyStat, escapeXml, nowBeijing, requestOrigin } from "./utils";

const app = new Hono<AppEnv>();

function isSafeOrigin(contextOrigin: string, requestUrl: string, configuredSiteUrl?: string): boolean {
  const allowed = new Set<string>([new URL(requestUrl).origin]);
  if (configuredSiteUrl) {
    try {
      allowed.add(new URL(configuredSiteUrl).origin);
    } catch {
      // ignore malformed configuration
    }
  }
  return allowed.has(contextOrigin);
}

app.use("/api/*", async (context, next) => {
  context.header("Cache-Control", "no-store");
  context.header("X-Content-Type-Options", "nosniff");
  context.header("Referrer-Policy", "strict-origin-when-cross-origin");
  context.header("X-Frame-Options", "DENY");
  context.header("Cross-Origin-Resource-Policy", "same-origin");
  context.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  const method = context.req.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const origin = context.req.header("origin");
    if (origin && !isSafeOrigin(origin, context.req.url, context.env.SITE_URL)) {
      return context.json({ error: "跨站请求被拒绝" }, 403);
    }
  }
  await next();
});

app.route("/api/auth", authRoutes);
app.use("/api/admin/*", requireAdmin);
app.route("/api/admin", adminRoutes);
app.route("/api", publicRoutes);

app.get("/go/:id", async (context) => {
  const id = Number.parseInt(context.req.param("id") ?? "", 10);
  if (!Number.isFinite(id) || id <= 0) return context.redirect("/", 302);
  const row = await context.env.DB.prepare("SELECT url FROM sites WHERE id = ?")
    .bind(id)
    .first<{ url: string }>();
  if (!row) return context.redirect("/", 302);
  await context.env.DB.prepare("UPDATE sites SET jumps = jumps + 1 WHERE id = ?")
    .bind(id)
    .run();
  await bumpDailyStat(context.env.DB, "jumps");
  return context.redirect(row.url, 302);
});

async function serveAdmin(context: Context<AppEnv>) {
  const assetUrl = new URL("/admin.html", context.req.url).toString();
  const response = await context.env.ASSETS.fetch(
    new Request(assetUrl, { method: "GET", headers: context.req.raw.headers }),
  );
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-cache");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'",
  );
  return new Response(response.body, { status: response.status, headers });
}

app.get("/admin", serveAdmin);
app.get("/admin/*", serveAdmin);

app.get("/sitemap.xml", async (context) => {
  const [sites, categories, pages] = await Promise.all([
    context.env.DB.prepare(
      "SELECT slug, updated_at FROM sites ORDER BY updated_at DESC",
    ).all<{ slug: string; updated_at: string }>(),
    context.env.DB.prepare("SELECT slug FROM categories ORDER BY sort_order, id").all<{ slug: string }>(),
    context.env.DB.prepare("SELECT slug, updated_at FROM pages WHERE is_published = 1 ORDER BY sort_order, id").all<{
      slug: string;
      updated_at: string;
    }>(),
  ]);
  const origin = requestOrigin(context.req.raw, context.env);
  const today = nowBeijing().slice(0, 10);
  const urls: string[] = [
    `<url><loc>${escapeXml(origin)}/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq></url>`,
    `<url><loc>${escapeXml(origin)}/about</loc><changefreq>monthly</changefreq></url>`,
    ...(sites.results ?? []).map(
      (site) =>
        `<url><loc>${escapeXml(origin)}/site/${escapeXml(site.slug)}</loc><lastmod>${escapeXml(site.updated_at.slice(0, 10))}</lastmod></url>`,
    ),
    ...(categories.results ?? []).map(
      (category) => `<url><loc>${escapeXml(origin)}/?cat=${escapeXml(category.slug)}</loc></url>`,
    ),
    ...(pages.results ?? []).map(
      (page) =>
        `<url><loc>${escapeXml(origin)}/page/${escapeXml(page.slug)}</loc><lastmod>${escapeXml(page.updated_at.slice(0, 10))}</lastmod></url>`,
    ),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
  return context.body(xml, 200, {
    "Content-Type": "application/xml; charset=utf-8",
    "Cache-Control": "public, max-age=3600",
  });
});

app.notFound((context) => context.json({ error: "接口不存在" }, 404));

app.onError((error, context) => {
  if (error instanceof HTTPException) {
    return context.json({ error: error.message }, error.status);
  }
  console.error("Unhandled worker error", error);
  return context.json({ error: "服务器内部错误，请稍后再试" }, 500);
});

// 没有 Cron / 定时任务：链接检测由新增、修改站点和后台手动触发
export default app;