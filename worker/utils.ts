import type {
  AdminCategory,
  AdminComment,
  AdminPage,
  AdminSite,
  AiProvider,
  Category,
  LinkStatus,
  PublicComment,
  PublicPage,
  Site,
  SiteConfigPublic,
  SiteDetail,
  SiteSettings,
} from "../shared/types";
import { AI_PROVIDERS, DEFAULT_AI_PROMPT } from "../shared/ai";
import { provinceOf } from "./commentmeta";
import type { Env } from "./env";

export const DEFAULT_SETTINGS: SiteSettings = {
  siteName: "锦囊书签",
  siteTagline: "把常用网站，收进一页纸里。",
  siteDescription: "一份克制、清晰、持续生长的网址收藏。",
  footerText: "锦囊书签 · 保持好奇，常回来看看。",
  seoKeywords: "导航站,网址导航,网址收藏,极简导航",
  githubAdmins: "",
  aiProvider: "pollinations",
  aiModel: "openai",
  aiBaseUrl: "",
  aiApiKey: "",
  aiPrompt: DEFAULT_AI_PROMPT,
  commentsEnabled: true,
  commentModeration: true,
  bannedWords: "博彩,赌场,代开发票,办证,加微信,裸聊,色情,成人视频,刷单,返利,USDT",
};

export function bool(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

export function int(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = int(value, fallback);
  return Math.min(max, Math.max(min, parsed));
}

/**
 * 当前北京时间，格式 `YYYY-MM-DD HH:MM:SS`。
 * 本项目数据库内统一存储北京时间（不是 UTC），所有写入时间戳都必须用它。
 */
export function nowBeijing(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return map.year + "-" + map.month + "-" + map.day + " " + map.hour + ":" + map.minute + ":" + map.second;
}

/**
 * 今日的日期键（北京时间 YYYY-MM-DD），用作 daily_stats.day 的主键。
 * 每天一行，跨天不需要重置任何计数。
 */
export function todayKey(): string {
  return nowBeijing().slice(0, 10);
}

/** 给「今天」那一行加一次计数：views = 页面被打开，jumps = 外链被点开。跨天自然写到新的一行。 */
export async function bumpDailyStat(db: D1Database, field: "views" | "jumps"): Promise<void> {
  const sql =
    field === "views"
      ? `INSERT INTO daily_stats (day, views, jumps) VALUES (?, 1, 0)
         ON CONFLICT(day) DO UPDATE SET views = daily_stats.views + 1`
      : `INSERT INTO daily_stats (day, views, jumps) VALUES (?, 0, 1)
         ON CONFLICT(day) DO UPDATE SET jumps = daily_stats.jumps + 1`;
  await db.prepare(sql).bind(todayKey()).run();
}

export function parseTags(value: unknown): string[] {
  let raw: unknown = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try {
        raw = JSON.parse(trimmed);
      } catch {
        raw = trimmed.split(",");
      }
    } else {
      raw = trimmed.split(/[,，]/);
    }
  }
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const tag = item.replace(/[#\r\n\t]/g, " ").trim().slice(0, 24);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
    if (tags.length >= 8) break;
  }
  return tags;
}

export function tagsToJson(value: unknown): string {
  return JSON.stringify(parseTags(value));
}

function parseStoredTags(value: unknown): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

export function asLinkStatus(value: unknown): LinkStatus {
  return value === "alive" || value === "warn" || value === "dead" ? value : "unknown";
}

export interface SiteRow {
  id: number;
  category_id: number;
  category_name?: string;
  category_slug?: string;
  name: string;
  slug: string;
  url: string;
  description: string;
  icon_url: string;
  screenshot_url: string;
  tags: string;
  detail_content?: string;
  views: number;
  jumps: number;
  ai_generated: number;
  ai_pending?: number | null;
  ai_error?: string | null;
  link_status: string;
  created_at: string;
  updated_at: string;
}

export function mapSite(row: SiteRow): Site {
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name ?? "",
    categorySlug: row.category_slug ?? "",
    name: row.name,
    slug: row.slug,
    url: row.url,
    domain: domainOf(row.url),
    description: row.description,
    iconUrl: row.icon_url,
    screenshotUrl: row.screenshot_url ?? "",
    tags: parseStoredTags(row.tags),
    views: row.views ?? 0,
    jumps: row.jumps,
    aiGenerated: !!row.ai_generated,
    aiPending: !!row.ai_pending,
    aiError: row.ai_error ?? "",
    linkStatus: asLinkStatus(row.link_status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}


export interface PageRow {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  show_in_nav: number;
  is_published: number;
  sort_order: number;
  views: number;
  created_at: string;
  updated_at: string;
}

export function mapPublicPage(row: PageRow): PublicPage {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    content: row.content,
    views: row.views ?? 0,
    updatedAt: row.updated_at,
  };
}

export function mapAdminPage(row: PageRow): AdminPage {
  return {
    ...mapPublicPage(row),
    showInNav: !!row.show_in_nav,
    isPublished: !!row.is_published,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

export function mapAdminSite(row: SiteRow): AdminSite {
  return { ...mapSite(row), detailContent: row.detail_content ?? "" };
}

export function mapSiteDetail(row: SiteRow, categoryPath: SiteDetail["categoryPath"]): SiteDetail {
  return {
    ...mapSite(row),
    detailContent: row.detail_content ?? "",
    categoryPath,
  };
}

export async function loadSettings(db: D1Database): Promise<SiteSettings> {
  let values: Record<string, string> = {};
  try {
    const { results } = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
    values = Object.fromEntries((results ?? []).map((row) => [row.key, row.value]));
  } catch {
    values = {};
  }
  const pick = (key: string, fallback: string) => values[key] ?? fallback;
  const rawProvider = pick("ai_provider", DEFAULT_SETTINGS.aiProvider) as AiProvider;
  return {
    siteName: pick("site_name", DEFAULT_SETTINGS.siteName),
    siteTagline: pick("site_tagline", DEFAULT_SETTINGS.siteTagline),
    siteDescription: pick("site_description", DEFAULT_SETTINGS.siteDescription),
    footerText: pick("footer_text", DEFAULT_SETTINGS.footerText),
    seoKeywords: pick("seo_keywords", DEFAULT_SETTINGS.seoKeywords),
    githubAdmins: pick("github_admins", DEFAULT_SETTINGS.githubAdmins),
    aiProvider: AI_PROVIDERS.includes(rawProvider) ? rawProvider : "pollinations",
    aiModel: pick("ai_model", DEFAULT_SETTINGS.aiModel),
    aiBaseUrl: pick("ai_base_url", DEFAULT_SETTINGS.aiBaseUrl),
    aiApiKey: pick("ai_api_key", DEFAULT_SETTINGS.aiApiKey),
    aiPrompt: pick("ai_prompt", DEFAULT_SETTINGS.aiPrompt) || DEFAULT_AI_PROMPT,
    commentsEnabled: pick("comments_enabled", "1") === "1",
    commentModeration: pick("comment_moderation", "1") === "1",
    bannedWords: pick("banned_words", DEFAULT_SETTINGS.bannedWords),
  };
}

export function publicSettings(settings: SiteSettings): SiteConfigPublic {
  return {
    siteName: settings.siteName,
    siteTagline: settings.siteTagline,
    siteDescription: settings.siteDescription,
    footerText: settings.footerText,
    seoKeywords: settings.seoKeywords,
    aiProvider: settings.aiProvider,
    aiModel: settings.aiModel,
    commentsEnabled: settings.commentsEnabled,
    commentModeration: settings.commentModeration,
    showComments: settings.commentsEnabled,
  };
}

export function mapCategory(row: {
  id: number;
  name: string;
  slug: string;
  description: string;
  icon: string;
  parent_id: number | null;
  sort_order: number;
  site_count?: number;
}): Category {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    icon: row.icon,
    parentId: row.parent_id,
    sortOrder: row.sort_order,
    siteCount: row.site_count ?? 0,
  };
}

export function mapAdminCategory(row: {
  id: number;
  name: string;
  slug: string;
  description: string;
  icon: string;
  parent_id: number | null;
  sort_order: number;
  direct_site_count?: number;
}): AdminCategory {
  return {
    ...mapCategory({ ...row, site_count: row.direct_site_count ?? 0 }),
    directSiteCount: row.direct_site_count ?? 0,
    totalSiteCount: 0,
  };
}

export function mapPublicComment(row: {
  id: number;
  site_id: number | null;
  page_id: number | null;
  author: string;
  website?: string;
  content: string;
  created_at: string;
  ip_location?: string;
}): PublicComment {
  const location = row.ip_location ?? "";
  return {
    id: row.id,
    siteId: row.site_id,
    pageId: row.page_id,
    author: row.author,
    website: row.website ?? "",
    content: row.content,
    createdAt: row.created_at,
    ipLocation: location,
    ipProvince: provinceOf(location),
  };
}

export function mapAdminComment(row: {
  id: number;
  site_id: number | null;
  page_id: number | null;
  target_type: "site" | "page";
  target_name: string;
  target_slug: string;
  author: string;
  email?: string;
  website?: string;
  content: string;
  status: string;
  ip_hash: string;
  ip?: string;
  user_agent?: string;
  device?: string;
  browser?: string;
  os?: string;
  ip_location?: string;
  created_at: string;
}): AdminComment {
  const location = row.ip_location ?? "";
  return {
    id: row.id,
    siteId: row.site_id,
    pageId: row.page_id,
    targetType: row.target_type,
    targetName: row.target_name,
    targetSlug: row.target_slug,
    author: row.author,
    email: row.email ?? "",
    website: row.website ?? "",
    content: row.content,
    status: row.status === "approved" || row.status === "spam" ? row.status : "pending",
    ipHash: row.ip_hash,
    ip: row.ip ?? "",
    userAgent: row.user_agent ?? "",
    device: row.device ?? "",
    browser: row.browser ?? "",
    os: row.os ?? "",
    ipLocation: location,
    ipProvince: provinceOf(location),
    createdAt: row.created_at,
  };
}

export async function categoryPath(db: D1Database, categoryId: number): Promise<SiteDetail["categoryPath"]> {
  const path: SiteDetail["categoryPath"] = [];
  let current: number | null = categoryId;
  for (let depth = 0; depth < 20 && current; depth += 1) {
    const row: { id: number; name: string; slug: string; parent_id: number | null } | null = await db
      .prepare("SELECT id, name, slug, parent_id FROM categories WHERE id = ?")
      .bind(current)
      .first<{ id: number; name: string; slug: string; parent_id: number | null }>();
    if (!row) break;
    path.unshift({ id: row.id, name: row.name, slug: row.slug });
    current = row.parent_id;
  }
  return path;
}

export function categoryDescendants(all: Array<{ id: number; parentId: number | null }>, rootId: number): Set<number> {
  const result = new Set<number>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of all) {
      if (item.parentId !== null && result.has(item.parentId) && !result.has(item.id)) {
        result.add(item.id);
        changed = true;
      }
    }
  }
  return result;
}

export function stableCategoryTree(categories: Category[]): Category[] {
  const nodes = new Map<number, Category>();
  for (const category of categories) nodes.set(category.id, { ...category, children: [] });
  const roots: Category[] = [];
  for (const category of nodes.values()) {
    if (category.parentId !== null && nodes.has(category.parentId)) {
      nodes.get(category.parentId)!.children!.push(category);
    } else {
      roots.push(category);
    }
  }
  const sort = (items: Category[]) => {
    items.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    for (const item of items) if (item.children?.length) sort(item.children);
  };
  sort(roots);
  return roots;
}

export function makeSlug(input: string, fallback = "item"): string {
  const base = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return base || fallback;
}

export async function uniqueSlug(
  db: D1Database,
  table: "sites" | "categories" | "pages",
  base: string,
  excludeId?: number,
): Promise<string> {
  const clean = makeSlug(base, table === "sites" ? "site" : table === "pages" ? "page" : "category");
  let candidate = clean;
  let counter = 2;
  for (;;) {
    const row = excludeId
      ? await db.prepare(`SELECT id FROM ${table} WHERE slug = ? AND id != ?`).bind(candidate, excludeId).first<{ id: number }>()
      : await db.prepare(`SELECT id FROM ${table} WHERE slug = ?`).bind(candidate).first<{ id: number }>();
    if (!row) return candidate;
    candidate = `${clean.slice(0, 58)}-${counter}`;
    counter += 1;
  }
}

export function normalizeUrl(input: string): string | null {
  let value = input.trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "::1" ||
    hostname === "0.0.0.0" ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d)\./.test(hostname)
  ) {
    return null;
  }
  url.hash = "";
  return url.toString();
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export async function visitorHash(request: Request, env: Env): Promise<string> {
  return (await sha256Hex(`${clientIp(request)}|${env.SESSION_SECRET ?? "local"}`)).slice(0, 32);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function base64UrlJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

export function parseBase64UrlJson<T>(value: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(value))) as T;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function hmacSign(secret: string, data: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(data));
  return base64UrlEncode(new Uint8Array(signature));
}

export async function hmacVerify(secret: string, data: string, signature: string): Promise<boolean> {
  try {
    const key = await hmacKey(secret);
    const signatureBytes = base64UrlDecode(signature);
    return await crypto.subtle.verify("HMAC", key, signatureBytes.buffer as ArrayBuffer, new TextEncoder().encode(data));
  } catch {
    return false;
  }
}

export function randomToken(bytes = 18): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function sessionSecret(env: Env): string {
  const secret = env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET is not configured (minimum 16 characters).");
  }
  return secret;
}

export function requestOrigin(request: Request, env: Env): string {
  if (env.SITE_URL) return env.SITE_URL.replace(/\/$/, "");
  return new URL(request.url).origin;
}

export function githubOauthConfigured(env: Env): boolean {
  return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function parsePage(value: unknown, fallback = 1): number {
  return clampInt(value, 1, 100000, fallback);
}