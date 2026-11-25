import type { CaptchaChallenge } from "../shared/types";
import type { Env } from "./env";
import { hmacSign, hmacVerify, base64UrlJson, parseBase64UrlJson, randomToken, sessionSecret } from "./utils";

interface CaptchaPayload {
  a: number;
  op: "+" | "-" | "*";
  b: number;
  exp: number;
  n: string;
}

const TTL_MS = 10 * 60 * 1000;

function answerOf(payload: Pick<CaptchaPayload, "a" | "op" | "b">): number {
  if (payload.op === "+") return payload.a + payload.b;
  if (payload.op === "-") return payload.a - payload.b;
  return payload.a * payload.b;
}

function questionOf(payload: Pick<CaptchaPayload, "a" | "op" | "b">): string {
  const symbol = payload.op === "*" ? "×" : payload.op;
  return `${payload.a} ${symbol} ${payload.b} = ?`;
}

export async function createCaptcha(env: Env): Promise<CaptchaChallenge> {
  const ops: Array<CaptchaPayload["op"]> = ["+", "-", "*"];
  const op = ops[Math.floor(Math.random() * ops.length)];
  let a = 2 + Math.floor(Math.random() * 8);
  let b = 2 + Math.floor(Math.random() * 8);
  if (op === "-" && b > a) [a, b] = [b, a];
  if (op === "*") {
    a = 2 + Math.floor(Math.random() * 7);
  }
  const payload: CaptchaPayload = {
    a,
    op,
    b,
    exp: Date.now() + TTL_MS,
    n: randomToken(8),
  };
  const body = base64UrlJson(payload);
  const signature = await hmacSign(sessionSecret(env), body);
  return {
    token: `${body}.${signature}`,
    question: questionOf(payload),
    expiresAt: new Date(payload.exp).toISOString(),
  };
}

export async function verifyCaptcha(env: Env, token: unknown, answer: unknown): Promise<{ ok: boolean; error?: string }> {
  if (typeof token !== "string") {
    return { ok: false, error: "请完成人机验证" };
  }
  if (answer === null || answer === undefined || answer === "") {
    return { ok: false, error: "请填写验证码答案" };
  }
  if (typeof answer === "number" && !Number.isFinite(answer)) {
    return { ok: false, error: "请完成人机验证" };
  }
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, error: "验证已失效，请刷新后重试" };
  const [body, signature] = parts;
  if (!(await hmacVerify(sessionSecret(env), body, signature))) {
    return { ok: false, error: "验证已失效，请刷新后重试" };
  }
  const payload = parseBase64UrlJson<CaptchaPayload>(body);
  if (!payload || ![payload.a, payload.b, payload.exp].every((n) => Number.isFinite(n))) {
    return { ok: false, error: "验证已失效，请刷新后重试" };
  }
  if (payload.exp < Date.now()) return { ok: false, error: "验证已过期，请刷新后重试" };
  if (payload.exp > Date.now() + TTL_MS + 60_000) return { ok: false, error: "验证无效" };
  const expected = answerOf(payload);
  const parsed = typeof answer === "number" ? answer : Number.parseInt(String(answer ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed !== expected) return { ok: false, error: "答案不正确，请重新计算" };
  return { ok: true };
}
