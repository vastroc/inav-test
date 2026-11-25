import { Hono } from "hono";
import type { Context } from "hono";
import type { Category, CommentsPayload, NavPage, NavPayload, NavStats, NavTag, RecentComment } from "../shared/types";
import type { AppEnv } from "./env";
import { createCaptcha, verifyCaptcha } from "./captcha";
import { clientIp, fillCommentLocation, parseUserAgent } from "./commentmeta";
import {
  bumpDailyStat,
  categoryPath,
  clampInt,
  loadSettings,
  mapCategory,
  mapPublicComment,
  mapPublicPage,
  mapSite,
  mapSiteDetail,
  nowBeijing,
  parsePage,
  publicSettings,
  stableCategoryTree,
  todayKey,
  visitorHash,
  type PageRow,
  type SiteRow,
} from "./utils";

const publicRoutes = new Hono<AppEnv>();

function aggregateCategoryCounts(nodes: Category[]): void {
  for (const node of nodes) {
    if (!node.children?.length) continue;
    aggregateCategoryCounts(node.children);
    node.siteCount += node.children.reduce((sum, child) => sum + child.siteCount, 0);
  }
}

publicRoutes.get("/health", (context) => {
  return context.json({ ok: true, time: nowBeijing() });
});

publicRoutes.get("/nav", async (context) => {
  const db = context.env.DB;
  const [
    categoryResult,
    countResult,
    siteResult,
    pageResult,
    settings,
    siteTotals,
    pageTotals,
    todayStats,
    commentTotals,
    linkGroups,
  ] =
    await Promise.all([
      db.prepare("SELECT id, name, slug, description, icon, parent_id, sort_order FROM categories ORDER BY sort_order, id").all<{
        id: number;
        name: string;
        slug: string;
        description: string;
        icon: string;
        parent_id: number | null;
        sort_order: number;
      }>(),
      db
        .prepare("SELECT category_id, COUNT(*) AS count FROM sites GROUP BY category_id")
        .all<{ category_id: number; count: number }>(),
      db
        .prepare(
          `SELECT s.*, c.name AS category_name, c.slug AS category_slug
           FROM sites s JOIN categories c ON c.id = s.category_id
           ORDER BY s.id`,
        )
        .all<SiteRow>(),
      db
        .prepare("SELECT id, title, slug, show_in_nav, sort_order FROM pages WHERE is_published = 1 ORDER BY sort_order, id")
        .all<{ id: number; title: string; slug: string; show_in_nav: number; sort_order: number }>(),
      loadSettings(db),
      db
        .prepare(
          "SELECT COUNT(*) AS sites, COALESCE(SUM(jumps), 0) AS jumps, COALESCE(SUM(views), 0) AS views FROM sites",
        )
        .first<{ sites: number; jumps: number; views: number }>(),
      db.prepare("SELECT COALESCE(SUM(views), 0) AS views FROM pages").first<{ views: number }>(),
      db
        .prepare("SELECT views, jumps FROM daily_stats WHERE day = ?")
        .bind(todayKey())
        .first<{ views: number; jumps: number }>(),
      db.prepare("SELECT COUNT(*) AS count FROM comments WHERE status = 'approved'").first<{ count: number }>(),
      db
        .prepare("SELECT link_status, COUNT(*) AS count FROM sites GROUP BY link_status")
        .all<{ link_status: string; count: number }>(),
    ]);

  const countMap = new Map((countResult.results ?? []).map((row) => [row.category_id, row.count]));
  const categories = (categoryResult.results ?? []).map((row) =>
    mapCategory({ ...row, site_count: countMap.get(row.id) ?? 0 }),
  );
  const tree = stableCategoryTree(categories);
  aggregateCategoryCounts(tree);

  const sites = (siteResult.results ?? []).map(mapSite);
  const tagCounts = new Map<string, number>();
  for (const site of sites) {
    for (const tag of site.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  // 前台标签栏全量返回：按次数降序（热门在前），次数相同按名称拼音升序，保证顺序稳定
  const tags: NavTag[] = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .map(([name, count]) => ({ name, count }));

  const links: Record<string, number> = {};
  for (const row of linkGroups.results ?? []) links[row.link_status] = row.count;

  const stats: NavStats = {
    totalSites: siteTotals?.sites ?? sites.length,
    // 全站浏览 = 站点详情页 + 所有独立页面（含首页、关于页）的累计浏览量
    totalViews: (siteTotals?.views ?? 0) + (pageTotals?.views ?? 0),
    totalJumps: siteTotals?.jumps ?? 0,
    totalComments: commentTotals?.count ?? 0,
    healthyLinks: links.alive ?? 0,
    deadLinks: links.dead ?? 0,
    unknownLinks: links.unknown ?? 0,
    todayViews: todayStats?.views ?? 0,
    todayJumps: todayStats?.jumps ?? 0,
  };

  const pages: NavPage[] = (pageResult.results ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    showInNav: !!row.show_in_nav,
    sortOrder: row.sort_order,
  }));

  const payload: NavPayload = {
    categories: tree,
    sites,
    pages,
    settings: publicSettings(settings),
    stats,
    tags,
  };
  return context.json(payload);
});


publicRoutes.get("/pages/:slug", async (context) => {
  const row = await context.env.DB.prepare(
    "SELECT * FROM pages WHERE slug = ? AND is_published = 1",
  )
    .bind(context.req.param("slug"))
    .first<PageRow>();
  if (!row) return context.json({ error: "没有找到这个页面" }, 404);
  return context.json(mapPublicPage(row));
});

publicRoutes.get("/sites/:slug", async (context) => {
  const slug = context.req.param("slug");
  const row = await context.env.DB.prepare(
    `SELECT s.*, c.name AS category_name, c.slug AS category_slug
     FROM sites s JOIN categories c ON c.id = s.category_id
     WHERE s.slug = ?`,
  )
    .bind(slug)
    .first<SiteRow>();
  if (!row) return context.json({ error: "没有找到这个站点" }, 404);
  const categoryTrail = await categoryPath(context.env.DB, row.category_id);
  return context.json(mapSiteDetail(row, categoryTrail));
});

publicRoutes.post("/sites/:id/jump", async (context) => {
  const id = Number.parseInt(context.req.param("id"), 10);
  if (!Number.isFinite(id)) return context.json({ error: "无效的站点" }, 400);
  const hit = await context.env.DB.prepare("UPDATE sites SET jumps = jumps + 1 WHERE id = ?").bind(id).run();
  if (!hit.meta.changes) return context.json({ error: "没有找到这个站点" }, 404);
  await bumpDailyStat(context.env.DB, "jumps");
  return context.json({ ok: true });
});

publicRoutes.post("/views", async (context) => {
  let body: { kind?: unknown; id?: unknown };
  try {
    body = await context.req.json();
  } catch {
    return context.json({ error: "无效的请求" }, 400);
  }
  const kind = typeof body.kind === "string" ? body.kind : "";
  if (kind !== "site" && kind !== "page") {
    return context.json({ error: "无效的页面类型" }, 400);
  }
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return context.json({ error: "无效的页面" }, 400);
  }
  const table = kind === "site" ? "sites" : "pages";
  // 一行更新该页面的累计浏览量，一行更新今天的总浏览量，同一个 batch 提交
  await context.env.DB.batch([
    context.env.DB.prepare(`UPDATE ${table} SET views = views + 1 WHERE id = ?`).bind(id),
    context.env.DB.prepare(
      `INSERT INTO daily_stats (day, views, jumps) VALUES (?, 1, 0)
       ON CONFLICT(day) DO UPDATE SET views = daily_stats.views + 1`,
    ).bind(todayKey()),
  ]);
  return context.json({ ok: true });
});

publicRoutes.get("/sites/:slug/comments", async (context) => {
  const slug = context.req.param("slug");
  const site = await context.env.DB.prepare(
    "SELECT id FROM sites WHERE slug = ?",
  )
    .bind(slug)
    .first<{ id: number }>();
  if (!site) return context.json({ error: "没有找到这个站点" }, 404);

  const page = parsePage(context.req.query("page"), 1);
  const pageSize = clampInt(context.req.query("pageSize"), 1, 50, 20);
  const offset = (page - 1) * pageSize;
  const [list, total] = await Promise.all([
    context.env.DB.prepare(
      `SELECT id, site_id, page_id, author, website, content, created_at, ip_location FROM comments
       WHERE site_id = ? AND status = 'approved'
       ORDER BY datetime(created_at) DESC, id DESC LIMIT ? OFFSET ?`,
    )
      .bind(site.id, pageSize, offset)
      .all<{
        id: number;
        site_id: number | null;
        page_id: number | null;
        author: string;
        website: string;
        content: string;
        created_at: string;
        ip_location: string;
      }>(),
    context.env.DB.prepare("SELECT COUNT(*) AS count FROM comments WHERE site_id = ? AND status = 'approved'")
      .bind(site.id)
      .first<{ count: number }>(),
  ]);
  const payload: CommentsPayload = {
    comments: (list.results ?? []).map(mapPublicComment),
    total: total?.count ?? 0,
    page,
    pageSize,
  };
  return context.json(payload);
});

publicRoutes.get("/pages/:slug/comments", async (context) => {
  const slug = context.req.param("slug");
  const page = await context.env.DB.prepare(
    "SELECT id FROM pages WHERE slug = ? AND is_published = 1",
  )
    .bind(slug)
    .first<{ id: number }>();
  if (!page) return context.json({ error: "没有找到这个页面" }, 404);

  const pageNumber = parsePage(context.req.query("page"), 1);
  const pageSize = clampInt(context.req.query("pageSize"), 1, 50, 20);
  const offset = (pageNumber - 1) * pageSize;
  const [list, total] = await Promise.all([
    context.env.DB.prepare(
      `SELECT id, site_id, page_id, author, website, content, created_at, ip_location FROM comments
       WHERE page_id = ? AND status = 'approved'
       ORDER BY datetime(created_at) DESC, id DESC LIMIT ? OFFSET ?`,
    )
      .bind(page.id, pageSize, offset)
      .all<{
        id: number;
        site_id: number | null;
        page_id: number | null;
        author: string;
        website: string;
        content: string;
        created_at: string;
        ip_location: string;
      }>(),
    context.env.DB.prepare("SELECT COUNT(*) AS count FROM comments WHERE page_id = ? AND status = 'approved'")
      .bind(page.id)
      .first<{ count: number }>(),
  ]);
  const payload: CommentsPayload = {
    comments: (list.results ?? []).map(mapPublicComment),
    total: total?.count ?? 0,
    page: pageNumber,
    pageSize,
  };
  return context.json(payload);
});

publicRoutes.get("/recent-comments", async (context) => {
  const limit = clampInt(context.req.query("limit"), 1, 10, 5);
  const rows = await context.env.DB.prepare(
    `SELECT c.id, c.author, c.content, c.created_at,
       CASE WHEN c.site_id IS NOT NULL THEN 'site' ELSE 'page' END AS target_type,
       COALESCE(s.name, p.title) AS target_name,
       COALESCE(s.slug, p.slug) AS target_slug
     FROM comments c
     LEFT JOIN sites s ON s.id = c.site_id
     LEFT JOIN pages p ON p.id = c.page_id
     WHERE c.status = 'approved'
       AND (c.site_id IS NOT NULL OR (c.page_id IS NOT NULL AND p.is_published = 1))
     ORDER BY datetime(c.created_at) DESC, c.id DESC LIMIT ?`,
  )
    .bind(limit)
    .all<{
      id: number;
      author: string;
      content: string;
      created_at: string;
      target_type: "site" | "page";
      target_name: string;
      target_slug: string;
    }>();
  const comments: RecentComment[] = (rows.results ?? []).map((row) => ({
    id: row.id,
    author: row.author,
    content: row.content,
    createdAt: row.created_at,
    targetType: row.target_type,
    targetName: row.target_name,
    targetSlug: row.target_slug,
  }));
  return context.json({ comments });
});

function spamReason(author: string, content: string, bannedWords: string): string | null {
  const haystack = `${author} ${content}`.toLowerCase();
  const banned = bannedWords
    .split(/[,，\n]/)
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);
  if (banned.some((word) => haystack.includes(word))) return "内容包含不被允许的词汇";
  const links = content.match(/https?:\/\/|www\./gi)?.length ?? 0;
  if (links > 2) return "评论中的链接过多";
  if (/(.)\1{14,}/u.test(content)) return "请避免重复发送相同字符";
  if (/[A-Za-z0-9+/=]{120,}/.test(content)) return "内容格式不正确";
  return null;
}

publicRoutes.post("/sites/:slug/comments", async (context) => {
  const site = await context.env.DB.prepare(
    "SELECT id FROM sites WHERE slug = ?",
  )
    .bind(context.req.param("slug"))
    .first<{ id: number }>();
  if (!site) return context.json({ error: "没有找到这个站点" }, 404);
  return submitComment(context, { siteId: site.id, pageId: null });
});

publicRoutes.post("/pages/:slug/comments", async (context) => {
  const page = await context.env.DB.prepare(
    "SELECT id FROM pages WHERE slug = ? AND is_published = 1",
  )
    .bind(context.req.param("slug"))
    .first<{ id: number }>();
  if (!page) return context.json({ error: "没有找到这个页面" }, 404);
  return submitComment(context, { siteId: null, pageId: page.id });
});

async function submitComment(
  context: Context<AppEnv>,
  target: { siteId: number | null; pageId: number | null },
): Promise<Response> {
  const settings = await loadSettings(context.env.DB);
  if (!settings.commentsEnabled) return context.json({ error: "评论功能暂时关闭" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await context.req.json();
  } catch {
    return context.json({ error: "无效的请求" }, 400);
  }
  if (body.company) return context.json({ error: "提交未通过验证" }, 400);

  const author = String(body.author ?? "").trim();
  const content = String(body.content ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  if (author.length < 1 || author.length > 24) return context.json({ error: "称呼需为 1-24 个字符" }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) {
    return context.json({ error: "请填写有效的邮箱地址" }, 400);
  }
  if (content.length < 5 || content.length > 800) return context.json({ error: "评论需为 5-800 个字符" }, 400);

  const website = cleanCommentWebsite(body.website);
  if (website === null) return context.json({ error: "个人网址格式不正确" }, 400);

  const startedAt = Number(body.startedAt);
  const elapsed = Date.now() - startedAt;
  if (!Number.isFinite(startedAt) || elapsed < 2500 || elapsed > 2 * 60 * 60 * 1000) {
    return context.json({ error: "表单已过期，请刷新页面后重试" }, 400);
  }

  const captcha = await verifyCaptcha(context.env, body.captchaToken, body.captchaAnswer);
  if (!captcha.ok) return context.json({ error: captcha.error || "人机验证失败" }, 400);

  const reason = spamReason(author, content, settings.bannedWords);
  if (reason) return context.json({ error: reason }, 400);

  const ipHash = (await visitorHash(context.req.raw, context.env)).slice(0, 24);
  const ip = clientIp(context.req.raw).slice(0, 64);
  const userAgent = (context.req.header("user-agent") ?? "").slice(0, 400);
  const { device, browser, os } = parseUserAgent(userAgent);
  const recent = await context.env.DB.prepare(
    "SELECT COUNT(*) AS count FROM comments WHERE ip_hash = ? AND datetime(created_at) > datetime('now', '+8 hours', '-10 minutes')",
  )
    .bind(ipHash)
    .first<{ count: number }>();
  if ((recent?.count ?? 0) >= 3) return context.json({ error: "提交过于频繁，请稍后再试" }, 429);
  const daily = await context.env.DB.prepare(
    "SELECT COUNT(*) AS count FROM comments WHERE ip_hash = ? AND datetime(created_at) > datetime('now', '+8 hours', '-1 day')",
  )
    .bind(ipHash)
    .first<{ count: number }>();
  if ((daily?.count ?? 0) >= 15) return context.json({ error: "今天提交的评论已达上限" }, 429);

  const duplicate = await context.env.DB.prepare(
    "SELECT id FROM comments WHERE ip_hash = ? AND content = ? AND datetime(created_at) > datetime('now', '+8 hours', '-10 minutes')",
  )
    .bind(ipHash, content)
    .first();
  if (duplicate) return context.json({ error: "这条评论已经提交过了" }, 409);

  const status = settings.commentModeration ? "pending" : "approved";
  const result = await context.env.DB.prepare(
    "INSERT INTO comments (site_id, page_id, author, email, website, content, status, ip_hash, ip, user_agent, device, browser, os, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      target.siteId,
      target.pageId,
      author,
      email,
      website,
      content,
      status,
      ipHash,
      ip,
      userAgent,
      device,
      browser,
      os,
      nowBeijing(),
      nowBeijing(),
    )
    .run();
  const id = Number(result.meta.last_row_id);

  // 归属地是外部接口，放后台补写：提交不等它，解析失败也不影响这条评论
  if (ip) {
    context.executionCtx.waitUntil(
      fillCommentLocation(context.env, id, ip).catch((error) => {
        console.error("Failed to resolve comment ip location", error);
      }),
    );
  }

  if (status === "approved") {
    const row = await context.env.DB.prepare(
      "SELECT id, site_id, page_id, author, website, content, created_at, ip_location FROM comments WHERE id = ?",
    )
      .bind(id)
      .first<{
        id: number;
        site_id: number | null;
        page_id: number | null;
        author: string;
        website: string;
        content: string;
        created_at: string;
        ip_location: string;
      }>();
    return context.json({
      ok: true,
      status,
      message: "评论已发布",
      comment: row ? mapPublicComment(row) : undefined,
    });
  }

  return context.json({
    ok: true,
    status,
    message: "评论已提交，审核通过后会显示在这里。",
  });
}

function cleanCommentWebsite(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.length > 300) return null;
  const candidate = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

publicRoutes.get("/captcha", async (context) => {
  const settings = await loadSettings(context.env.DB);
  if (!settings.commentsEnabled) return context.json({ error: "评论功能暂时关闭" }, 403);
  try {
    return context.json(await createCaptcha(context.env));
  } catch (error) {
    console.error("Captcha generation failed", error);
    return context.json({ error: "验证码服务未配置" }, 500);
  }
});

export default publicRoutes;