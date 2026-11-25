import { Hono } from "hono";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type {
  AdminSettingsPayload,
  AdminTag,
  AdminTagsPayload,
  AiProvider,
  PaginatedAdminSites,
  SiteSettings,
} from "../shared/types";
import type { AppEnv, Env } from "./env";
import { aiConfigured, aiKeysStatus, defaultModel, generateDescription } from "./ai";
import { AI_PROVIDERS, DEFAULT_AI_PROMPT } from "../shared/ai";
import { checkOneSite, checkSites } from "./linkcheck";
import {
  categoryDescendants,
  clampInt,
  githubOauthConfigured,
  int,
  loadSettings,
  makeSlug,
  mapAdminCategory,
  mapAdminComment,
  mapAdminPage,
  mapAdminSite,
  normalizeUrl,
  nowBeijing,
  parsePage,
  parseTags,
  tagsToJson,
  uniqueSlug,
  bool,
  type PageRow,
  type SiteRow,
} from "./utils";

const adminRoutes = new Hono<AppEnv>();

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502;

function fail(message: string, status: ErrorStatus = 400): never {
  throw new HTTPException(status, { message });
}

async function jsonBody(context: Context<AppEnv>): Promise<Record<string, unknown>> {
  try {
    const body = await context.req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) fail("无效的请求内容");
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    fail("请求内容不是有效的 JSON");
  }
}

function has(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function text(value: unknown, max: number, label: string, required = false): string {
  const result = String(value ?? "").trim();
  if (required && !result) fail(`${label}不能为空`);
  if (result.length > max) fail(`${label}不能超过 ${max} 个字符`);
  return result;
}

function parseId(context: Context<AppEnv>): number {
  const id = Number.parseInt(context.req.param("id") ?? "", 10);
  if (!Number.isFinite(id) || id <= 0) fail("无效的 ID");
  return id;
}

function parseProvider(value: unknown): AiProvider | null {
  return AI_PROVIDERS.find((provider) => provider === value) ?? null;
}

function cleanAssetUrl(value: unknown, label: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("/")) return raw.slice(0, 500);
  const normalized = normalizeUrl(raw);
  if (!normalized) fail(`${label}必须是 http(s) 链接或站内相对路径`);
  return normalized;
}

async function findSiteRow(db: D1Database, id: number): Promise<SiteRow | null> {
  return db
    .prepare(
      `SELECT s.*, c.name AS category_name, c.slug AS category_slug
       FROM sites s JOIN categories c ON c.id = s.category_id WHERE s.id = ?`,
    )
    .bind(id)
    .first<SiteRow>();
}

async function categoryExists(db: D1Database, id: number): Promise<boolean> {
  return Boolean(await db.prepare("SELECT id FROM categories WHERE id = ?").bind(id).first());
}

/* ---------- AI 简介（后台异步生成） ---------- */

/**
 * 后台生成简介：先把 ai_pending 置 1 再交给 waitUntil，响应立刻返回。
 * force = false 时写入带「description 为空」条件，避免覆盖用户在这期间手填的简介；
 * 用户主动点「重试」时 force = true，覆盖旧简介。
 * 失败把原因写进 ai_error 并清掉 pending，前端据此提示与重试。
 */
async function runAiDescription(context: Context<AppEnv>, siteId: number, force = false): Promise<void> {
  const db = context.env.DB;
  try {
    const row = await findSiteRow(db, siteId);
    if (!row) return;
    const settings = await loadSettings(db);
    if (!aiConfigured(context.env, settings)) {
      await db
        .prepare("UPDATE sites SET ai_pending = 0, ai_error = ? WHERE id = ?")
        .bind("没有可用的 AI 密钥，请到后台「设置 → AI 简介」配置", siteId)
        .run();
      return;
    }
    const generated = await generateDescription(context.env, settings, {
      name: row.name,
      url: row.url,
      categoryName: row.category_name,
      tags: parseTags(row.tags),
      currentDescription: row.description,
    });
    const guard = force ? "" : " AND (description IS NULL OR TRIM(description) = '')";
    await db
      .prepare(
        `UPDATE sites SET description = ?, ai_generated = 1, ai_pending = 0, ai_error = NULL, updated_at = ?
         WHERE id = ?${guard}`,
      )
      .bind(generated.description, nowBeijing(), siteId)
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 生成失败";
    console.error("AI description failed", siteId, message);
    await db
      .prepare("UPDATE sites SET ai_pending = 0, ai_error = ?, updated_at = ? WHERE id = ?")
      .bind(message.slice(0, 200), nowBeijing(), siteId)
      .run()
      .catch(() => undefined);
  } finally {
    // 简介已被用户填写、或成功/失败都已落库时，兜底清掉 pending，避免一直转圈
    await db
      .prepare("UPDATE sites SET ai_pending = 0 WHERE id = ? AND ai_pending = 1")
      .bind(siteId)
      .run()
      .catch(() => undefined);
  }
}

/** 把生成任务交给 waitUntil（响应返回后仍可执行，Cloudflare 上限为响应后 30s） */
function queueAiDescription(context: Context<AppEnv>, siteId: number, force = false): void {
  context.executionCtx.waitUntil(
    runAiDescription(context, siteId, force).catch((error) => {
      console.error("Queued AI description failed", siteId, error);
    }),
  );
}

/* ---------- 标签（方案 A：不建表，聚合 sites.tags 的 JSON） ---------- */

interface SiteTagsRow {
  id: number;
  tags: string;
}

async function loadSiteTags(db: D1Database): Promise<SiteTagsRow[]> {
  const rows = await db.prepare("SELECT id, tags FROM sites").all<SiteTagsRow>();
  return rows.results ?? [];
}

/**
 * 按 sites.tags 聚合标签：同名忽略大小写，保留第一次出现的写法；
 * 排序为使用次数降序、名称升序。
 */
function summarizeTags(rows: SiteTagsRow[]): AdminTag[] {
  const map = new Map<string, AdminTag>();
  for (const row of rows) {
    for (const tag of parseTags(row.tags)) {
      const key = tag.toLowerCase();
      const found = map.get(key);
      if (found) found.count += 1;
      else map.set(key, { name: tag, count: 1 });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"));
}

/** D1 batch 一把提交几百条 UPDATE 容易超限，按 50 条分批。 */
async function applyTagUpdates(db: D1Database, updates: Array<{ id: number; tags: string }>): Promise<void> {
  const stamp = nowBeijing();
  const statements = updates.map((item) =>
    db.prepare("UPDATE sites SET tags = ?, updated_at = ? WHERE id = ?").bind(item.tags, stamp, item.id),
  );
  for (let index = 0; index < statements.length; index += 50) {
    await db.batch(statements.slice(index, index + 50));
  }
}

/** 把书签里的若干标签统一替换成 target，单个改名与批量改名共用。 */
function rewriteTags(
  rows: SiteTagsRow[],
  keys: Set<string>,
  target: string,
): { updates: Array<{ id: number; tags: string }>; changed: number; truncated: number } {
  const updates: Array<{ id: number; tags: string }> = [];
  let changed = 0;
  let truncated = 0;
  for (const row of rows) {
    const tags = parseTags(row.tags);
    if (!tags.some((tag) => keys.has(tag.toLowerCase()))) continue;
    const mapped = tags.map((tag) => (keys.has(tag.toLowerCase()) ? target : tag));
    // parseTags 会去重并截断到 8 个；只有真的超过 8 个才算丢标签，纯去重不算
    if (new Set(mapped.map((tag) => tag.toLowerCase())).size > 8) truncated += 1;
    const deduped = parseTags(mapped);
    const before = JSON.stringify(tags);
    const after = JSON.stringify(deduped);
    if (before === after) continue;
    updates.push({ id: row.id, tags: after });
    changed += 1;
  }
  return { updates, changed, truncated };
}

adminRoutes.get("/sites", async (context) => {
  const db = context.env.DB;
  const page = parsePage(context.req.query("page"), 1);
  const pageSize = clampInt(context.req.query("pageSize"), 1, 100, 20);
  const q = (context.req.query("q") ?? "").trim().slice(0, 80);
  const link = context.req.query("link") ?? "all";
  const category = Number.parseInt(context.req.query("category") ?? "", 10);
  const conditions: string[] = [];
  const bindings: Array<string | number> = [];

  if (q) {
    const like = `%${q}%`;
    conditions.push("(s.name LIKE ? OR s.url LIKE ? OR s.description LIKE ? OR s.tags LIKE ?)");
    bindings.push(like, like, like, like);
  }
  if (link === "alive" || link === "warn" || link === "dead" || link === "unknown") {
    conditions.push("s.link_status = ?");
    bindings.push(link);
  }
  if (Number.isFinite(category) && category > 0) {
    const all = await db.prepare("SELECT id, parent_id FROM categories").all<{ id: number; parent_id: number | null }>();
    const ids = categoryDescendants(
      (all.results ?? []).map((row) => ({ id: row.id, parentId: row.parent_id })),
      category,
    );
    if (ids.size) {
      conditions.push(`s.category_id IN (${[...ids].map(() => "?").join(",")})`);
      bindings.push(...ids);
    }
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const count = await db.prepare(`SELECT COUNT(*) AS count FROM sites s ${where}`).bind(...bindings).first<{ count: number }>();
  const rows = await db
    .prepare(
      `SELECT s.*, c.name AS category_name, c.slug AS category_slug
       FROM sites s JOIN categories c ON c.id = s.category_id
       ${where} ORDER BY s.id LIMIT ? OFFSET ?`,
    )
    .bind(...bindings, pageSize, (page - 1) * pageSize)
    .all<SiteRow>();
  const payload: PaginatedAdminSites = {
    sites: (rows.results ?? []).map(mapAdminSite),
    total: count?.count ?? 0,
    page,
    pageSize,
  };
  return context.json(payload);
});

adminRoutes.get("/sites/:id", async (context) => {
  const row = await findSiteRow(context.env.DB, parseId(context));
  if (!row) return context.json({ error: "站点不存在" }, 404);
  return context.json(mapAdminSite(row));
});

adminRoutes.post("/sites", async (context) => {
  const db = context.env.DB;
  const body = await jsonBody(context);
  const name = text(body.name, 80, "站点名称", true);
  const rawUrl = text(body.url, 500, "网址", true);
  const url = normalizeUrl(rawUrl);
  if (!url) fail("网址无效，或指向了不允许的本地地址");
  const categoryId = int(body.categoryId, 0);
  if (!categoryId || !(await categoryExists(db, categoryId))) fail("请选择有效的分类");

  let slug = text(body.slug, 80, "路径");
  if (!slug) {
    const host = new URL(url).hostname.replace(/^www\./, "");
    slug = makeSlug(host || name, "site");
  }
  slug = await uniqueSlug(db, "sites", slug);

  const iconUrl = cleanAssetUrl(body.iconUrl, "图标地址");
  const screenshotUrl = cleanAssetUrl(body.screenshotUrl, "截图地址");
  const tags = tagsToJson(body.tags);
  const detailContent = text(body.detailContent, 40000, "详情介绍");
  const settings = await loadSettings(db);

  const description = text(body.description, 1200, "站点描述");
  // 简介留空时不在请求里等 AI，只打个 pending 标记，交给 waitUntil 后台生成
  const aiQueued = !description && body.generateAi !== false && aiConfigured(context.env, settings);

  const result = await db
    .prepare(
      `INSERT INTO sites
       (category_id, name, slug, url, description, icon_url, screenshot_url, tags, detail_content, ai_generated, ai_pending, link_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', ?, ?)`,
    )
    .bind(
      categoryId,
      name,
      slug,
      url,
      description,
      iconUrl,
      screenshotUrl,
      tags,
      detailContent,
      0,
      aiQueued ? 1 : 0,
      nowBeijing(),
      nowBeijing(),
    )
    .run();
  const row = await findSiteRow(db, Number(result.meta.last_row_id));
  if (row) {
    if (aiQueued) queueAiDescription(context, row.id);
    // 新增站点后自动检测一次链接（不是定时任务，只在这次保存时跑）
    context.executionCtx.waitUntil(
      checkOneSite(context.env, { id: row.id, name: row.name, url: row.url }).catch((error) => {
        console.error("Automatic link check after create failed", error);
      }),
    );
  }
  return context.json({ site: row ? mapAdminSite(row) : null, aiQueued }, 201);
});

adminRoutes.put("/sites/:id", async (context) => {
  const db = context.env.DB;
  const id = parseId(context);
  const existing = await findSiteRow(db, id);
  if (!existing) return context.json({ error: "站点不存在" }, 404);
  const body = await jsonBody(context);

  const name = has(body, "name") ? text(body.name, 80, "站点名称", true) : existing.name;
  let url = existing.url;
  if (has(body, "url")) {
    const normalized = normalizeUrl(text(body.url, 500, "网址", true));
    if (!normalized) fail("网址无效，或指向了不允许的本地地址");
    url = normalized;
  }
  const categoryId = has(body, "categoryId") ? int(body.categoryId, 0) : existing.category_id;
  if (!categoryId || !(await categoryExists(db, categoryId))) fail("请选择有效的分类");

  let slug = existing.slug;
  if (has(body, "slug")) {
    const requested = text(body.slug, 80, "路径") || existing.slug;
    slug = await uniqueSlug(db, "sites", requested, id);
  }
  const iconUrl = has(body, "iconUrl") ? cleanAssetUrl(body.iconUrl, "图标地址") : existing.icon_url;
  const screenshotUrl = has(body, "screenshotUrl")
    ? cleanAssetUrl(body.screenshotUrl, "截图地址")
    : existing.screenshot_url;
  const tags = has(body, "tags") ? tagsToJson(body.tags) : existing.tags;
  const detailContent = has(body, "detailContent")
    ? text(body.detailContent, 40000, "详情介绍")
    : existing.detail_content ?? "";
  const settings = await loadSettings(db);

  const description = has(body, "description") ? text(body.description, 1200, "站点描述") : existing.description;
  let aiGenerated = !!existing.ai_generated;
  if (has(body, "description") && description !== existing.description) aiGenerated = false;
  // 简介被清空且允许 AI 时，同样只打 pending 标记，后台生成，不再阻塞这次保存
  const aiQueued = !description && body.generateAi !== false && aiConfigured(context.env, settings);
  const aiPending = aiQueued ? 1 : description ? 0 : Number(existing.ai_pending ?? 0);
  const aiError = aiQueued || description ? null : existing.ai_error ?? null;

  await db
    .prepare(
      `UPDATE sites SET category_id = ?, name = ?, slug = ?, url = ?, description = ?, icon_url = ?, screenshot_url = ?, tags = ?,
       detail_content = ?, ai_generated = ?, ai_pending = ?, ai_error = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(
      categoryId,
      name,
      slug,
      url,
      description,
      iconUrl,
      screenshotUrl,
      tags,
      detailContent,
      aiGenerated ? 1 : 0,
      aiPending,
      aiError,
      nowBeijing(),
      id,
    )
    .run();
  if (aiQueued) queueAiDescription(context, id);
  const row = await findSiteRow(db, id);
  if (row) {
    // 保存后自动检测一次链接（不是定时任务，只跟这次保存走）
    context.executionCtx.waitUntil(
      checkOneSite(context.env, { id: row.id, name: row.name, url: row.url }).catch((error) => {
        console.error("Automatic link check after update failed", error);
      }),
    );
  }
  return context.json({ site: row ? mapAdminSite(row) : null, aiQueued });
});

adminRoutes.delete("/sites/:id", async (context) => {
  const id = parseId(context);
  const result = await context.env.DB.prepare("DELETE FROM sites WHERE id = ?").bind(id).run();
  if (!result.meta.changes) return context.json({ error: "站点不存在" }, 404);
  return context.json({ ok: true });
});

adminRoutes.post("/sites/:id/generate-description", async (context) => {
  const db = context.env.DB;
  const id = parseId(context);
  const row = await findSiteRow(db, id);
  if (!row) return context.json({ error: "站点不存在" }, 404);
  const body = await jsonBody(context);
  const provider = body.provider === undefined ? undefined : parseProvider(body.provider);
  if (body.provider !== undefined && !provider) fail("未知的 AI 服务");
  const settings = await loadSettings(db);

  // async = true：后台生成，列表里显示“AI 生成中”，前端轮询结果（列表行上的「重试」走这条）
  if (bool(body.async)) {
    if (!aiConfigured(context.env, settings, provider ?? settings.aiProvider)) {
      fail("当前 AI 服务没有可用密钥，请到「设置 → AI 简介」配置");
    }
    await db
      .prepare("UPDATE sites SET ai_pending = 1, ai_error = NULL, updated_at = ? WHERE id = ?")
      .bind(nowBeijing(), id)
      .run();
    // 主动重试：允许覆盖已有简介
    queueAiDescription(context, id, true);
    return context.json({ queued: true }, 202);
  }

  try {
    const generated = await generateDescription(
      context.env,
      settings,
      {
        name: row.name,
        url: row.url,
        categoryName: row.category_name,
        tags: parseTags(row.tags),
        currentDescription: row.description,
      },
      provider ? { provider } : undefined,
    );
    await db
      .prepare("UPDATE sites SET description = ?, ai_generated = 1, ai_pending = 0, ai_error = NULL, updated_at = ? WHERE id = ?")
      .bind(generated.description, nowBeijing(), id)
      .run();
    return context.json(generated);
  } catch (error) {
    return context.json(
      { error: "AI 生成失败", detail: error instanceof Error ? error.message : String(error) },
      502,
    );
  }
});

adminRoutes.post("/sites/:id/check", async (context) => {
  const row = await findSiteRow(context.env.DB, parseId(context));
  if (!row) return context.json({ error: "站点不存在" }, 404);
  const result = await checkOneSite(context.env, { id: row.id, name: row.name, url: row.url });
  return context.json(result);
});

adminRoutes.post("/check-all", async (context) => {
  let body: Record<string, unknown> = {};
  try {
    body = (await context.req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const limit = clampInt(body.limit, 1, 20, 15);
  const rows = await context.env.DB.prepare(
    `SELECT id, name, url FROM sites
     ORDER BY CASE WHEN link_checked_at IS NULL THEN 0 ELSE 1 END, datetime(link_checked_at) ASC LIMIT ?`,
  )
    .bind(limit)
    .all<{ id: number; name: string; url: string }>();
  const results = await checkSites(context.env, rows.results ?? [], 4);
  return context.json({ results, checked: results.length });
});

adminRoutes.get("/categories", async (context) => {
  const rows = await context.env.DB.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM sites s WHERE s.category_id = c.id) AS direct_site_count
     FROM categories c ORDER BY c.sort_order, c.id`,
  ).all<{
    id: number;
    name: string;
    slug: string;
    description: string;
    icon: string;
    parent_id: number | null;
    sort_order: number;
    direct_site_count: number;
  }>();
  const categories = (rows.results ?? []).map(mapAdminCategory);
  for (const category of categories) {
    const ids = categoryDescendants(
      categories.map((item) => ({ id: item.id, parentId: item.parentId })),
      category.id,
    );
    category.totalSiteCount = categories
      .filter((item) => ids.has(item.id))
      .reduce((sum, item) => sum + item.directSiteCount, 0);
  }
  return context.json({ categories });
});

adminRoutes.post("/categories", async (context) => {
  const db = context.env.DB;
  const body = await jsonBody(context);
  const name = text(body.name, 40, "分类名称", true);
  const parentId = body.parentId === null || body.parentId === undefined || body.parentId === "" ? null : int(body.parentId, 0);
  if (parentId !== null && !(await categoryExists(db, parentId))) fail("上级分类不存在");
  const requestedSlug = text(body.slug, 60, "分类路径");
  const slug = await uniqueSlug(db, "categories", requestedSlug || name, undefined);
  const description = text(body.description, 300, "分类描述");
  const icon = text(body.icon, 30, "分类图标") || "folder";
  const sortOrder = has(body, "sortOrder")
    ? clampInt(body.sortOrder, -100000, 100000, 0)
    : (await db
        .prepare("SELECT COALESCE(MAX(sort_order), 0) + 10 AS next FROM categories WHERE parent_id IS ?")
        .bind(parentId)
        .first<{ next: number }>())?.next ?? 10;
  const result = await db
    .prepare(
      "INSERT INTO categories (name, slug, description, icon, parent_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(name, slug, description, icon, parentId, sortOrder, nowBeijing(), nowBeijing())
    .run();
  const id = Number(result.meta.last_row_id);
  const row = await db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM sites s WHERE s.category_id = c.id) AS direct_site_count
       FROM categories c WHERE c.id = ?`,
    )
    .bind(id)
    .first<{
      id: number;
      name: string;
      slug: string;
      description: string;
      icon: string;
      parent_id: number | null;
      sort_order: number;
      direct_site_count: number;
    }>();
  return context.json({ category: row ? mapAdminCategory(row) : null }, 201);
});

adminRoutes.put("/categories/:id", async (context) => {
  const db = context.env.DB;
  const id = parseId(context);
  const existing = await db.prepare("SELECT * FROM categories WHERE id = ?").bind(id).first<{
    id: number;
    name: string;
    slug: string;
    description: string;
    icon: string;
    parent_id: number | null;
    sort_order: number;
  }>();
  if (!existing) return context.json({ error: "分类不存在" }, 404);
  const body = await jsonBody(context);
  const name = has(body, "name") ? text(body.name, 40, "分类名称", true) : existing.name;
  const description = has(body, "description") ? text(body.description, 300, "分类描述") : existing.description;
  const icon = has(body, "icon") ? text(body.icon, 30, "分类图标") || "folder" : existing.icon;
  const sortOrder = has(body, "sortOrder") ? clampInt(body.sortOrder, -100000, 100000, existing.sort_order) : existing.sort_order;
  let parentId = has(body, "parentId")
    ? body.parentId === null || body.parentId === "" || body.parentId === undefined
      ? null
      : int(body.parentId, 0)
    : existing.parent_id;

  if (parentId !== null) {
    if (!(await categoryExists(db, parentId))) fail("上级分类不存在");
    const all = await db.prepare("SELECT id, parent_id FROM categories").all<{ id: number; parent_id: number | null }>();
    const descendants = categoryDescendants(
      (all.results ?? []).map((row) => ({ id: row.id, parentId: row.parent_id })),
      id,
    );
    if (descendants.has(parentId)) fail("不能把分类移动到它自己或子分类下面");
  }
  let slug = existing.slug;
  if (has(body, "slug")) {
    const requested = text(body.slug, 60, "分类路径") || existing.slug;
    slug = await uniqueSlug(db, "categories", requested, id);
  }
  await db
    .prepare(
      "UPDATE categories SET name = ?, slug = ?, description = ?, icon = ?, parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?",
    )
    .bind(name, slug, description, icon, parentId, sortOrder, nowBeijing(), id)
    .run();
  return context.json({ ok: true });
});

adminRoutes.delete("/categories/:id", async (context) => {
  const db = context.env.DB;
  const id = parseId(context);
  const children = await db.prepare("SELECT COUNT(*) AS count FROM categories WHERE parent_id = ?").bind(id).first<{ count: number }>();
  const sites = await db.prepare("SELECT COUNT(*) AS count FROM sites WHERE category_id = ?").bind(id).first<{ count: number }>();
  if ((children?.count ?? 0) > 0) return context.json({ error: "请先移动或删除子分类" }, 409);
  if ((sites?.count ?? 0) > 0) return context.json({ error: "请先移动或删除该分类下的站点" }, 409);
  const result = await db.prepare("DELETE FROM categories WHERE id = ?").bind(id).run();
  if (!result.meta.changes) return context.json({ error: "分类不存在" }, 404);
  return context.json({ ok: true });
});

adminRoutes.get("/tags", async (context) => {
  const rows = await loadSiteTags(context.env.DB);
  const payload: AdminTagsPayload = {
    tags: summarizeTags(rows),
    totalSites: rows.filter((row) => parseTags(row.tags).length > 0).length,
  };
  return context.json(payload);
});

/**
 * 重命名标签。目标名已存在时：
 * - 不传 merge 返回 409（conflict/target/count），由前端弹「合并 / 取消」；
 * - merge:true 则把原标签整体并入已有标签，书签数量不变。
 */
adminRoutes.post("/tags/rename", async (context) => {
  const db = context.env.DB;
  const body = await jsonBody(context);
  const from = text(body.from, 24, "原标签名", true);
  const to = text(body.to, 24, "新标签名", true);
  const [requested] = parseTags([to]);
  if (!requested) fail("标签名不能为空");

  const rows = await loadSiteTags(db);
  const lowerFrom = from.toLowerCase();
  const summaries = summarizeTags(rows);
  if (!summaries.some((tag) => tag.name.toLowerCase() === lowerFrom)) {
    return context.json({ error: "标签不存在，可能已经被删除" }, 404);
  }

  // 仅大小写不同属于统一写法，不算撞名
  const conflict = summaries.find(
    (tag) => tag.name.toLowerCase() === requested.toLowerCase() && tag.name.toLowerCase() !== lowerFrom,
  );
  let target = requested;
  if (conflict) {
    if (body.merge !== true) {
      return context.json({ error: "已存在同名标签", conflict: true, target: conflict.name, count: conflict.count }, 409);
    }
    target = conflict.name;
  }

  const { updates, changed, truncated } = rewriteTags(rows, new Set([lowerFrom]), target);
  await applyTagUpdates(db, updates);
  return context.json({ ok: true, changed, merged: Boolean(conflict), target, truncated });
});

/**
 * 批量重命名：把选中的多个标签统一改成同一个名字（等同批量合并）。
 * 目标名被未选中的标签占用时，同样支持 409 → merge:true。
 */
adminRoutes.post("/tags/bulk-rename", async (context) => {
  const db = context.env.DB;
  const body = await jsonBody(context);
  const raw = Array.isArray(body.names) ? body.names : [body.name];
  const keys = new Set(
    raw
      .map((item) => String(item ?? "").replace(/[#\r\n\t]/g, " ").trim().slice(0, 24).toLowerCase())
      .filter(Boolean),
  );
  if (!keys.size) fail("请选择要重命名的标签");
  if (keys.size > 200) fail("一次最多处理 200 个标签");
  const to = text(body.to, 24, "新标签名", true);
  const [requested] = parseTags([to]);
  if (!requested) fail("标签名不能为空");

  const rows = await loadSiteTags(db);
  const summaries = summarizeTags(rows);
  if (!summaries.some((tag) => keys.has(tag.name.toLowerCase()))) {
    return context.json({ error: "选中的标签都已经被删除" }, 404);
  }

  // 目标是未选中的已有标签时算撞名；目标是选中项之一则视为统一写法
  const conflict = summaries.find(
    (tag) => tag.name.toLowerCase() === requested.toLowerCase() && !keys.has(tag.name.toLowerCase()),
  );
  let target = requested;
  if (conflict) {
    if (body.merge !== true) {
      return context.json({ error: "已存在同名标签", conflict: true, target: conflict.name, count: conflict.count }, 409);
    }
    target = conflict.name;
  }

  const { updates, changed, truncated } = rewriteTags(rows, keys, target);
  await applyTagUpdates(db, updates);
  return context.json({ ok: true, changed, merged: Boolean(conflict), target, truncated, renamed: keys.size });
});adminRoutes.post("/tags/remove", async (context) => {
  const db = context.env.DB;
  const body = await jsonBody(context);
  const raw = Array.isArray(body.names) ? body.names : [body.name];
  const names = new Set(
    raw
      .map((item) => String(item ?? "").replace(/[#\r\n\t]/g, " ").trim().slice(0, 24).toLowerCase())
      .filter(Boolean),
  );
  if (!names.size) fail("请选择要删除的标签");
  if (names.size > 200) fail("一次最多删除 200 个标签");

  const rows = await loadSiteTags(db);
  const updates: Array<{ id: number; tags: string }> = [];
  let changed = 0;
  for (const row of rows) {
    const tags = parseTags(row.tags);
    const kept = tags.filter((tag) => !names.has(tag.toLowerCase()));
    if (kept.length === tags.length) continue;
    updates.push({ id: row.id, tags: JSON.stringify(kept) });
    changed += 1;
  }
  await applyTagUpdates(db, updates);
  return context.json({ ok: true, changed, removed: names.size });
});


/** 前台写死了 /about 路由、首页计数也挂在这两行上，slug 被改或行被删都会直接出问题 */
const BUILTIN_PAGE_SLUGS = new Set(["home", "about"]);

adminRoutes.get("/pages", async (context) => {
  const rows = await context.env.DB.prepare(
    "SELECT * FROM pages ORDER BY sort_order, id",
  ).all<PageRow>();
  return context.json({ pages: (rows.results ?? []).map(mapAdminPage) });
});

adminRoutes.get("/pages/:id", async (context) => {
  const row = await context.env.DB.prepare("SELECT * FROM pages WHERE id = ?")
    .bind(parseId(context))
    .first<PageRow>();
  if (!row) return context.json({ error: "页面不存在" }, 404);
  return context.json(mapAdminPage(row));
});

adminRoutes.post("/pages", async (context) => {
  const db = context.env.DB;
  const body = await jsonBody(context);
  const title = text(body.title, 80, "页面标题", true);
  let slug = text(body.slug, 80, "页面路径");
  if (!slug) slug = makeSlug(title, "page");
  slug = await uniqueSlug(db, "pages", slug);
  const excerpt = text(body.excerpt, 300, "页面摘要");
  const content = text(body.content, 100000, "页面内容");
  const showInNav = body.showInNav === undefined ? true : bool(body.showInNav);
  const isPublished = body.isPublished === undefined ? true : bool(body.isPublished);
  const sortOrder = has(body, "sortOrder")
    ? clampInt(body.sortOrder, -100000, 100000, 0)
    : (await db.prepare("SELECT COALESCE(MAX(sort_order), 0) + 10 AS next FROM pages").first<{ next: number }>())?.next ?? 10;
  const result = await db
    .prepare(
      `INSERT INTO pages (title, slug, excerpt, content, show_in_nav, is_published, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(title, slug, excerpt, content, showInNav ? 1 : 0, isPublished ? 1 : 0, sortOrder, nowBeijing(), nowBeijing())
    .run();
  const row = await db.prepare("SELECT * FROM pages WHERE id = ?")
    .bind(Number(result.meta.last_row_id))
    .first<PageRow>();
  return context.json({ page: row ? mapAdminPage(row) : null }, 201);
});

adminRoutes.put("/pages/:id", async (context) => {
  const db = context.env.DB;
  const id = parseId(context);
  const existing = await db.prepare("SELECT * FROM pages WHERE id = ?").bind(id).first<PageRow>();
  if (!existing) return context.json({ error: "页面不存在" }, 404);
  const body = await jsonBody(context);
  const title = has(body, "title") ? text(body.title, 80, "页面标题", true) : existing.title;
  let slug = existing.slug;
  if (has(body, "slug")) {
    const requested = text(body.slug, 80, "页面路径") || existing.slug;
    if (BUILTIN_PAGE_SLUGS.has(existing.slug) && requested !== existing.slug) {
      return context.json({ error: "首页与关于页的路径不可修改" }, 400);
    }
    slug = await uniqueSlug(db, "pages", requested, id);
  }
  const excerpt = has(body, "excerpt") ? text(body.excerpt, 300, "页面摘要") : existing.excerpt;
  const content = has(body, "content") ? text(body.content, 100000, "页面内容") : existing.content;
  const showInNav = has(body, "showInNav") ? bool(body.showInNav) : !!existing.show_in_nav;
  const isPublished = has(body, "isPublished") ? bool(body.isPublished) : !!existing.is_published;
  const sortOrder = has(body, "sortOrder")
    ? clampInt(body.sortOrder, -100000, 100000, existing.sort_order)
    : existing.sort_order;
  await db.prepare(
    `UPDATE pages SET title = ?, slug = ?, excerpt = ?, content = ?, show_in_nav = ?, is_published = ?, sort_order = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(title, slug, excerpt, content, showInNav ? 1 : 0, isPublished ? 1 : 0, sortOrder, nowBeijing(), id)
    .run();
  const row = await db.prepare("SELECT * FROM pages WHERE id = ?").bind(id).first<PageRow>();
  return context.json({ page: row ? mapAdminPage(row) : null });
});

adminRoutes.delete("/pages/:id", async (context) => {
  const id = parseId(context);
  const existing = await context.env.DB.prepare("SELECT slug FROM pages WHERE id = ?").bind(id).first<{ slug: string }>();
  if (!existing) return context.json({ error: "页面不存在" }, 404);
  if (BUILTIN_PAGE_SLUGS.has(existing.slug)) {
    return context.json({ error: "首页与关于页是内置页面，不能删除" }, 400);
  }
  await context.env.DB.prepare("DELETE FROM pages WHERE id = ?").bind(id).run();
  return context.json({ ok: true });
});

adminRoutes.get("/comments", async (context) => {
  const db = context.env.DB;
  const status = context.req.query("status") ?? "all";
  const q = (context.req.query("q") ?? "").trim().slice(0, 80);
  const page = parsePage(context.req.query("page"), 1);
  // pageSize=0 表示「全部」：取足够大的上限（评论量级远小于此）
  const pageSize = clampInt(context.req.query("pageSize") === "0" ? "200" : context.req.query("pageSize"), 1, 200, 20);
  const conditions: string[] = [];
  const bindings: Array<string | number> = [];
  if (status === "pending" || status === "approved" || status === "spam") {
    conditions.push("cm.status = ?");
    bindings.push(status);
  }
  if (q) {
    const like = `%${q}%`;
    conditions.push("(cm.author LIKE ? OR cm.content LIKE ? OR s.name LIKE ? OR p.title LIKE ?)");
    bindings.push(like, like, like, like);
  }
  const joins = "LEFT JOIN sites s ON s.id = cm.site_id LEFT JOIN pages p ON p.id = cm.page_id";
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const count = await db
    .prepare(`SELECT COUNT(*) AS count FROM comments cm ${joins} ${where}`)
    .bind(...bindings)
    .first<{ count: number }>();
  const rows = await db
    .prepare(
      `SELECT cm.*, CASE WHEN cm.site_id IS NOT NULL THEN 'site' ELSE 'page' END AS target_type,
         COALESCE(s.name, p.title) AS target_name, COALESCE(s.slug, p.slug) AS target_slug
       FROM comments cm ${joins} ${where}
       ORDER BY CASE cm.status WHEN 'pending' THEN 0 ELSE 1 END, datetime(cm.created_at) DESC LIMIT ? OFFSET ?`,
    )
    .bind(...bindings, pageSize, (page - 1) * pageSize)
    .all<{
      id: number;
      site_id: number | null;
      page_id: number | null;
      target_type: "site" | "page";
      target_name: string;
      target_slug: string;
      author: string;
      email: string;
      website: string;
      content: string;
      status: string;
      ip_hash: string;
      ip: string;
      user_agent: string;
      device: string;
      browser: string;
      os: string;
      ip_location: string;
      created_at: string;
    }>();
  return context.json({
    comments: (rows.results ?? []).map(mapAdminComment),
    total: count?.count ?? 0,
    page,
    pageSize,
  });
});

adminRoutes.patch("/comments/:id", async (context) => {
  const id = parseId(context);
  const body = await jsonBody(context);
  const status = body.status;
  if (status !== "pending" && status !== "approved" && status !== "spam") fail("无效的评论状态");
  const result = await context.env.DB.prepare("UPDATE comments SET status = ?, updated_at = ? WHERE id = ?")
    .bind(status, nowBeijing(), id)
    .run();
  if (!result.meta.changes) return context.json({ error: "评论不存在" }, 404);
  return context.json({ ok: true });
});

adminRoutes.delete("/comments/:id", async (context) => {
  const result = await context.env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(parseId(context)).run();
  if (!result.meta.changes) return context.json({ error: "评论不存在" }, 404);
  return context.json({ ok: true });
});

/** 设置下发前统一脱敏：只回「是否已保存密钥」，不回明文 */
function settingsPayload(env: Env, settings: SiteSettings): AdminSettingsPayload {
  return {
    settings: { ...settings, aiApiKey: "" },
    aiKeys: aiKeysStatus(env, settings),
    aiApiKeySet: Boolean(settings.aiApiKey),
    githubOauthConfigured: githubOauthConfigured(env),
  };
}

adminRoutes.get("/settings", async (context) => {
  const settings = await loadSettings(context.env.DB);
  return context.json(settingsPayload(context.env, settings));
});

const SETTING_FIELDS: Record<string, keyof SiteSettings> = {
  site_name: "siteName",
  site_tagline: "siteTagline",
  site_description: "siteDescription",
  footer_text: "footerText",
  seo_keywords: "seoKeywords",
  github_admins: "githubAdmins",
  ai_provider: "aiProvider",
  ai_model: "aiModel",
  ai_base_url: "aiBaseUrl",
  ai_api_key: "aiApiKey",
  ai_prompt: "aiPrompt",
  comments_enabled: "commentsEnabled",
  comment_moderation: "commentModeration",
  banned_words: "bannedWords",
};

adminRoutes.put("/settings", async (context) => {
  const db = context.env.DB;
  const body = await jsonBody(context);
  const currentSettings = await loadSettings(db);
  const updates: Array<[string, string]> = [];

  // Keys are stored in snake_case; map from the camelCase request body.
  for (const [dbKey, camelKey] of Object.entries(SETTING_FIELDS)) {
    if (!has(body, camelKey)) continue;
    const value = body[camelKey];
    if (dbKey === "comments_enabled" || dbKey === "comment_moderation") {
      updates.push([dbKey, bool(value) ? "1" : "0"]);
    } else if (dbKey === "ai_provider") {
      const provider = parseProvider(value);
      if (!provider) fail("未知的 AI 服务");
      updates.push([dbKey, provider]);
    } else if (dbKey === "ai_base_url") {
      const raw = String(value ?? "").trim();
      if (raw) {
        const url = normalizeUrl(raw);
        if (!url) fail("AI 接口地址必须是 http(s) 链接");
        updates.push([dbKey, url.replace(/\/$/, "")]);
      } else {
        updates.push([dbKey, ""]);
      }
    } else if (dbKey === "github_admins") {
      const admins = String(value ?? "")
        .split(/[,，\s]+/)
        .map((item) => item.trim())
        .filter((item) => /^[a-zA-Z0-9-]{1,39}$/.test(item))
        .join(",");
      updates.push([dbKey, admins]);
    } else if (dbKey === "seo_keywords") {
      updates.push([dbKey, text(value, 300, "SEO 关键词")]);
    } else if (dbKey === "banned_words") {
      updates.push([dbKey, text(value, 5000, "屏蔽词")]);
    } else if (dbKey === "site_name") {
      updates.push([dbKey, text(value, 60, "站点名称", true)]);
    } else if (dbKey === "ai_model") {
      const model = text(value, 100, "AI 模型");
      const provider = parseProvider(body.aiProvider) ?? currentSettings.aiProvider;
      updates.push([dbKey, model || defaultModel(provider)]);
    } else if (dbKey === "ai_api_key") {
      // 留空表示清除已保存的密钥；接口从不回传明文，前端只在用户重新填写时才提交
      updates.push([dbKey, text(value, 300, "AI API Key")]);
    } else if (dbKey === "ai_prompt") {
      updates.push([dbKey, text(value, 4000, "AI 提示词") || DEFAULT_AI_PROMPT]);
    } else {
      const max = dbKey === "site_tagline" ? 160 : dbKey === "site_description" ? 500 : dbKey === "footer_text" ? 300 : 200;
      updates.push([dbKey, text(value, max, "设置项")]);
    }
  }
  if (!updates.length) fail("没有需要保存的设置");

  // 自定义接口必须自带地址和模型，否则保存后也无法生成，直接拦在保存这一步
  const nextProvider = (updates.find(([key]) => key === "ai_provider")?.[1] ?? currentSettings.aiProvider) as AiProvider;
  if (nextProvider === "custom") {
    const base = updates.find(([key]) => key === "ai_base_url")?.[1] ?? currentSettings.aiBaseUrl;
    const model = updates.find(([key]) => key === "ai_model")?.[1] ?? currentSettings.aiModel;
    if (!base) fail("自定义 AI 接口需要填写接口地址，例如 https://api.example.com/v1");
    if (!model) fail("自定义 AI 接口需要填写模型名称");
  }

  const statements = updates.map(([key, value]) =>
    db.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    ).bind(key, value, nowBeijing()),
  );
  await db.batch(statements);
  const settings = await loadSettings(db);
  return context.json(settingsPayload(context.env, settings));
});

adminRoutes.post("/reorder", async (context) => {
  const body = await jsonBody(context);
  const type = body.type;
  // 书签已取消自定义排序（顺序固定为添加顺序），这里只处理分类和独立页面
  if (type !== "categories" && type !== "pages") fail("未知的排序类型");
  if (!Array.isArray(body.ids) || body.ids.length === 0) fail("排序列表不能为空");
  const ids = body.ids.map((value) => int(value, 0)).filter((value) => value > 0);
  if (ids.length !== body.ids.length || ids.length > 500) fail("排序列表无效");
  const table = type === "categories" ? "categories" : "pages";
  await context.env.DB.batch(
    ids.map((id, index) =>
      context.env.DB.prepare(`UPDATE ${table} SET sort_order = ?, updated_at = ? WHERE id = ?`)
        .bind((index + 1) * 10, nowBeijing(), id),
    ),
  );
  return context.json({ ok: true });
});

export default adminRoutes;
