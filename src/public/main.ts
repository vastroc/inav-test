import "./styles.css";
import { categoryIcon } from "../lib/categoryIcons";
import { formatDate, timeAgo } from "../lib/datetime";
import { renderMarkdown } from "../lib/markdown";
import type {
  CaptchaChallenge,
  Category,
  CommentSubmitResult,
  CommentsPayload,
  NavPayload,
  PageViewKind,
  PublicComment,
  PublicPage,
  RecentComment,
  Site,
  SiteDetail,
} from "../../shared/types";

const appRoot = document.getElementById("app")!;

type Theme = "light" | "dark";
type SortMode = "manual" | "name" | "jumps";
type SortDir = "asc" | "desc";

interface CommentValues {
  author: string;
  email: string;
  website: string;
  content: string;
  answer: string;
}

interface CommentState {
  targetType: "site" | "page";
  targetSlug: string;
  page: number;
  total: number;
  comments: PublicComment[];
  captcha: CaptchaChallenge | null;
  captchaError: string;
  startedAt: number;
  loadingMore: boolean;
  busy: boolean;
  notice: string;
  error: string;
  values: CommentValues;
}

interface AppState {
  nav: NavPayload | null;
  navError: string;
  expanded: Set<number>;
  more: number;
  theme: Theme;
  comments: CommentState | null;
  routeSeq: number;
  commentSeq: number;
}

const state: AppState = {
  nav: null,
  navError: "",
  expanded: new Set<number>(),
  more: 120,
  theme:
    document.documentElement.dataset.theme === "dark"
      ? "dark"
      : localStorage.getItem("iNav-theme") === "dark"
        ? "dark"
        : "light",
  comments: null,
  routeSeq: 0,
  commentSeq: 0,
};

const numberFormat = new Intl.NumberFormat("zh-CN");

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function num(value: number | null | undefined): string {
  return numberFormat.format(Number(value ?? 0));
}

function compact(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (n < 10000) return String(n);
  return (n / 10000).toFixed(n >= 100000 ? 0 : 1) + "万";
}

function eyeIcon(): string {
  return (
    '<svg class="eye-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>' +
    "</svg>"
  );
}

/** 外链跳转图标（方框 + 出框箭头），与眼睛图标区分：跳转是离开本站，浏览是停在本页 */
function jumpIcon(): string {
  return (
    '<svg class="jump-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>' +
    "</svg>"
  );
}

/** 详情页统计徽标：桌面用完整文案，移动端换成精简文案（少几个字，三个徽标才排得进一行） */
function detailBadge(icon: string, title: string, full: string, mini: string): string {
  return (
    '<span class="detail-view-badge" title="' + esc(title) + '">' + icon +
    '<span class="badge-full">' + full + "</span>" +
    '<span class="badge-mini">' + mini + "</span></span>"
  );
}

function initialOf(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

function faviconFor(site: Site | SiteDetail): string {
  if (site.iconUrl) return site.iconUrl;
  try {
    return "https://t3.gstatic.cn/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=" +
      encodeURIComponent(new URL(site.url).origin) +
      "&size=64";
  } catch {
    return "";
  }
}

function screenshotFor(site: SiteDetail): { src: string; fallback: string; automatic: boolean } {
  if (site.screenshotUrl) return { src: site.screenshotUrl, fallback: "", automatic: false };
  return {
    src: "https://s0.wp.com/mshots/v1/" + encodeURIComponent(site.url) + "?w=1200&h=675",
    fallback: "https://image.thum.io/get/width/1200/crop/800/noanimate/" + site.url,
    automatic: true,
  };
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  const text = await response.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // keep text response
  }
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : "请求失败（" + response.status + "）";
    throw new Error(message);
  }
  return data as T;
}

function setMeta(name: string, content: string, property = false): void {
  const selector = property ? 'meta[property="' + name + '"]' : 'meta[name="' + name + '"]';
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement("meta");
    if (property) element.setAttribute("property", name);
    else element.setAttribute("name", name);
    document.head.appendChild(element);
  }
  element.setAttribute("content", content);
}

function themeIcon(theme: Theme): string {
  const path =
    theme === "dark"
      ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/>'
      : '<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8Z"/>';
  return (
    '<svg class="theme-svg" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    path +
    "</svg>"
  );
}

/** 移动端分类入口：汉堡图标，尺寸与右侧主题按钮一致 */
function menuIcon(): string {
  return (
    '<svg class="menu-svg" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M4 7h16M4 12h16M4 17h16"/>' +
    "</svg>"
  );
}

/** 抽屉右上角的关闭图标，尺寸与菜单按钮同款 */
function closeIcon(): string {
  return (
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M6 6l12 12M18 6 6 18"/>' +
    "</svg>"
  );
}

function applyTheme(theme: Theme): void {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#131313" : "#f5f5f5");
  try {
    localStorage.setItem("iNav-theme", theme);
  } catch {
    // ignore storage errors
  }
  const next = theme === "dark" ? "浅色" : "深色";
  document.querySelectorAll<HTMLButtonElement>('[data-action="theme"]').forEach((button) => {
    button.setAttribute("aria-label", "切换到" + next);
    button.title = "切换到" + next;
    const icon = button.querySelector<HTMLElement>("[data-theme-icon]");
    if (icon) icon.innerHTML = themeIcon(theme);
  });
}

function trackJump(siteId: number): void {
  if (!Number.isFinite(siteId)) return;
  void fetch("/api/sites/" + siteId + "/jump", {
    method: "POST",
    keepalive: true,
  }).catch(() => {
    // A failed beacon should never block the outbound link.
  });
}

function trackView(kind: PageViewKind, id = 0): void {
  try {
    const key = "inav:view:" + kind + ":" + id;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch {
    // ignore storage errors
  }
  void fetch("/api/views", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, id }),
    keepalive: true,
    credentials: "same-origin",
  }).catch(() => undefined);
}

/** 首页和关于页也是 pages 里的行，按 slug 找到各自的 id 再上报 */
function trackPageView(slug: string): void {
  const id = (state.nav?.pages ?? []).find((page) => page.slug === slug)?.id;
  if (id) trackView("page", id);
}

function flattenCategories(categories: Category[]): Category[] {
  const result: Category[] = [];
  const walk = (items: Category[]) => {
    for (const item of items) {
      result.push(item);
      if (item.children?.length) walk(item.children);
    }
  };
  walk(categories);
  return result;
}

function findCategory(categories: Category[], slug: string | null): Category | null {
  if (!slug) return null;
  for (const category of categories) {
    if (category.slug === slug) return category;
    if (category.children?.length) {
      const found = findCategory(category.children, slug);
      if (found) return found;
    }
  }
  return null;
}

function descendantIds(categories: Category[], rootId: number): Set<number> {
  const ids = new Set<number>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const category of categories) {
      if (category.parentId !== null && ids.has(category.parentId) && !ids.has(category.id)) {
        ids.add(category.id);
        changed = true;
      }
    }
  }
  return ids;
}

function parentIds(categories: Category[]): number[] {
  return flattenCategories(categories)
    .filter((category) => category.children?.length)
    .map((category) => category.id);
}

function homeHref(changes: Record<string, string | null>): string {
  const params = new URLSearchParams(location.search);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  return query ? "/?" + query : "/";
}

function parseSort(value: string | null): SortMode {
  return value === "name" || value === "jumps" ? value : "manual";
}

/** 默认方向：时间（添加时间）降序、名称升序、浏览量降序 */
function defaultSortDir(mode: SortMode): SortDir {
  return mode === "name" ? "asc" : "desc";
}

function parseSortDir(value: string | null, mode: SortMode): SortDir {
  return value === "asc" || value === "desc" ? value : defaultSortDir(mode);
}

function tagHref(tag: string): string {
  return "/?tag=" + encodeURIComponent(tag);
}

function themeButton(): string {
  const next = state.theme === "dark" ? "浅色" : "深色";
  return (
    '<button type="button" class="theme-toggle" data-action="theme" aria-label="切换到' +
    next +
    '" title="切换到' +
    next +
    '"><span class="theme-icon" data-theme-icon>' +
    themeIcon(state.theme) +
    "</span></button>"
  );
}

type NavLink = { href: string; title: string; active: boolean };

/**
 * 顶部导航与移动端抽屉共用的导航项：首页 + 后台设为「显示在导航」的独立页面 + 关于。
 * limitPages 只限制页面数量（桌面顶栏放不下），抽屉里全量展示。
 */
function navLinks(limitPages?: number): NavLink[] {
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const pages = (state.nav?.pages ?? []).filter((page) => page.showInNav);
  const shown = typeof limitPages === "number" ? pages.slice(0, limitPages) : pages;
  const links: NavLink[] = [{ href: "/", title: "首页", active: path === "/" }];
  for (const page of shown) {
    const href = "/page/" + encodeURIComponent(page.slug);
    links.push({ href, title: page.title, active: path === href });
  }
  links.push({ href: "/about", title: "关于", active: path === "/about" });
  return links;
}

function renderHeader(): string {
  const settings = state.nav?.settings;
  const pageLinks = navLinks(6)
    .map((link) => '<a href="' + link.href + '" data-link' + (link.active ? ' class="active"' : "") + ">" + esc(link.title) + "</a>")
    .join("");
  return (
    '<header class="top"><div class="wrap top-inner">' +
    '<button type="button" class="top-menu" data-action="open-cats" aria-label="打开菜单" aria-expanded="false" aria-controls="site-drawer" title="菜单">' +
    menuIcon() +
    "</button>" +
    '<a class="brand" href="/" data-link><span class="brand-mark">' +
    esc((settings?.siteName ?? "锦囊书签").slice(0, 1)) +
    "</span><span>" +
    esc(settings?.siteName ?? "锦囊书签") +
    "</span></a>" +
    '<nav class="nav">' + pageLinks + "</nav>" +
    '<div class="top-links">' + themeButton() + "</div></div></header>"
  );
}

function renderFooter(): string {
  const settings = state.nav?.settings;
  const pages = (state.nav?.pages ?? []).filter((page) => page.showInNav).slice(0, 4);
  return (
    '<footer class="footer"><div class="wrap footer-inner">' +
    "<span>" + esc(settings?.footerText ?? "保持好奇，常回来看看。") + "</span>" +
    '<span class="footer-links">' +
    pages.map((page) => '<a href="/page/' + encodeURIComponent(page.slug) + '" data-link>' + esc(page.title) + "</a>").join("") +
    "<a href=\"/about\" data-link>关于</a>" +
    "</span></div>" +
    '<div class="wrap footer-copy">© ' + new Date().getFullYear() + " " +
    esc(settings?.siteName ?? "锦囊书签") + " 其名为碰</div></footer>"
  );
}

function shell(main: string, title: string, description?: string): void {
  // 首页（含按分类/标签筛选）才有分类可筛；独立页面只给导航
  const isHome = (location.pathname.replace(/\/+$/, "") || "/") === "/";
  appRoot.innerHTML =
    renderHeader() +
    "<main>" +
    main +
    "</main>" +
    renderFooter() +
    renderDrawer(isHome);
  // 重渲染后按钮是新的，把抽屉开关状态同步回 aria-expanded
  setDrawer(document.body.classList.contains("cats-open"));
  document.title = title;
  const settings = state.nav?.settings;
  setMeta("description", description || settings?.siteDescription || "");
  setMeta("og:title", title, true);
  setMeta("og:description", description || settings?.siteDescription || "", true);
}

/** 抽屉开关：同时维护菜单按钮的 aria-expanded */
function setDrawer(open: boolean): void {
  document.body.classList.toggle("cats-open", open);
  document.querySelector<HTMLElement>(".top-menu")?.setAttribute("aria-expanded", open ? "true" : "false");
}

function navigate(url: string, replace = false): void {
  if (replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  state.more = 120;
  setDrawer(false);
  window.scrollTo(0, 0);
  void renderRoute();
}

async function boot(): Promise<void> {
  appRoot.innerHTML = '<div class="boot">正在加载站点索引…</div>';
  watchCardTagOverflow();
  try {
    const nav = await api<NavPayload>("/api/nav");
    state.nav = nav;
    state.navError = "";
    state.expanded = new Set(parentIds(nav.categories));
    await renderRoute();
  } catch (error) {
    state.navError = error instanceof Error ? error.message : "导航数据加载失败";
    appRoot.innerHTML =
      '<div class="wrap error-box"><p>' + esc(state.navError) +
      '</p><button type="button" class="btn primary" data-action="reload-nav">重新加载</button></div>';
  }
}

async function renderRoute(): Promise<void> {
  const seq = ++state.routeSeq;
  state.comments = null;
  const path = location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/") {
    renderHome();
    trackPageView("home");
    return;
  }
  if (path === "/about") {
    await renderAbout();
    return;
  }
  const siteMatch = path.match(/^\/site\/([^/]+)$/);
  if (siteMatch) {
    await renderSitePage(decodeURIComponent(siteMatch[1]), seq);
    return;
  }
  const pageMatch = path.match(/^\/page\/([^/]+)$/);
  if (pageMatch) {
    await renderStandalonePage(decodeURIComponent(pageMatch[1]), seq);
    return;
  }
  renderNotFound();
}



function renderCategoryNodes(categories: Category[], selectedSlug: string | null): string {
  return categories
    .map((category) => {
      const hasChildren = Boolean(category.children?.length);
      const open = state.expanded.has(category.id);
      const active = selectedSlug === category.slug;
      const toggle = hasChildren
        ? '<button type="button" class="cat-toggle" data-action="toggle-cat" data-id="' +
          category.id +
          '" aria-label="' +
          (open ? "收起" : "展开") +
          " " +
          esc(category.name) +
          '">' +
          (open ? "−" : "+") +
          "</button>"
        : '<span class="cat-toggle cat-toggle--empty"></span>';
      const href = homeHref({ cat: category.slug, q: null, tag: null });
      return (
        "<li>" +
        '<div class="cat-row' + (active ? " active" : "") + '">' +
        toggle +
        '<a class="cat-link" href="' + esc(href) + '" data-link>' +
        '<span class="cat-icon-wrap">' + categoryIcon(category.icon) + "</span>" +
        '<span class="cat-name">' + esc(category.name) + "</span>" +
        '<span class="cat-count">' + num(category.siteCount) + "</span>" +
        "</a></div>" +
        (hasChildren && open ? '<ul class="cat-children">' + renderCategoryNodes(category.children!, selectedSlug) + "</ul>" : "") +
        "</li>"
      );
    })
    .join("");
}

/** 分类列表：桌面侧栏与移动端抽屉共用 */
function renderCategoryList(categories: Category[], selectedSlug: string | null, totalSites: number): string {
  return (
    '<ul class="cat-list">' +
    '<li><a class="cat-all' + (selectedSlug ? "" : " active") + '" href="/" data-link><span class="cat-icon-wrap">' +
    categoryIcon("layout") +
    '</span><span>全部站点</span><span class="cat-count">' +
    num(totalSites) +
    "</span></a></li>" +
    renderCategoryNodes(categories, selectedSlug) +
    "</ul>"
  );
}

/** 桌面端左侧常驻分类栏（≤900px 隐藏，改由抽屉承载） */
function renderSidebar(categories: Category[], selectedSlug: string | null, totalSites: number): string {
  return '<aside class="sidebar" aria-label="站点分类">' + renderCategoryList(categories, selectedSlug, totalSites) + "</aside>";
}

/**
 * 移动端抽屉（≤900px 使用）：导航链接固定在最上方，分类只在首页出现。
 * 独立页面（详情 / 单页 / 关于）没有分类语境，只给导航，避免点进分类跳回首页。
 */
function renderDrawer(showCategories: boolean): string {
  const nav = state.nav;
  const links = navLinks()
    .map(
      (link) =>
        '<a class="drawer-link' + (link.active ? " active" : "") + '" href="' + link.href + '" data-link title="' +
        esc(link.title) + '">' + esc(link.title) + "</a>"
    )
    .join("");
  const selectedSlug = new URLSearchParams(location.search).get("cat");
  const cats =
    showCategories && nav ? '<p class="drawer-label">分类</p>' + renderCategoryList(nav.categories, selectedSlug, nav.stats.totalSites) : "";
  return (
    '<button type="button" class="sidebar-scrim" data-action="close-cats" aria-label="关闭菜单"></button>' +
    '<aside class="drawer" id="site-drawer" aria-label="站点导航">' +
    '<div class="drawer-head"><span class="drawer-title">' +
    esc(nav?.settings.siteName ?? "锦囊书签") +
    '</span><button type="button" class="drawer-close" data-action="close-cats" aria-label="关闭菜单" title="关闭">' +
    closeIcon() +
    "</button></div>" +
    '<div class="drawer-body">' +
    '<p class="drawer-label">导航</p>' +
    '<div class="drawer-nav">' + links + "</div>" +
    cats +
    "</div></aside>"
  );
}

function renderCard(site: Site, showCategory: boolean): string {
  const icon = faviconFor(site);
  const description = site.description || "暂无简介。";
  // “AI 生成”标签固定排在第一位
  const aiTag = site.aiGenerated ? '<span class="tag ai" title="简介由 AI 生成">AI 生成</span>' : "";
  // 全部标签都渲染，装不下时靠轮播完整展示，不再截断成“前 3 个 + N”
  const tags = site.tags
    .map((tag) => '<a class="tag" href="' + esc(tagHref(tag)) + '" data-link>' + esc(tag) + "</a>")
    .join("");
  const category = showCategory && site.categoryName
    ? '<a class="card-cat" href="/?cat=' + encodeURIComponent(site.categorySlug) + '" data-link title="查看分类：' +
      esc(site.categoryName) +
      '">' +
      categoryIcon("folder") +
      esc(site.categoryName) +
      "</a>"
    : "";
  // 所有书签都开放详情页（是否可见/是否开放已不再作为配置项）
  // 详情页在新标签打开：不带 data-link，交给浏览器默认行为（data-link 会被 SPA 路由拦截成同标签跳转）
  const detail =
    '<a class="detail-link" href="/site/' + encodeURIComponent(site.slug) + '" target="_blank" rel="noopener noreferrer">查看详情</a>';
  return (
    '<article class="card">' +
    '<a class="card-body" href="' + esc(site.url) + '" target="_blank" rel="noopener noreferrer" data-site-jump="' + site.id + '">' +
    '<div class="card-head">' +
    '<span class="site-icon"><span class="fallback">' + esc(initialOf(site.name)) + "</span>" +
    (icon ? '<img src="' + esc(icon) + '" alt="" loading="lazy" referrerpolicy="no-referrer" data-icon>' : "") +
    "</span>" +
    '<span class="card-title-wrap"><span class="card-title">' + esc(site.name) + "</span></span>" +
    "</div>" +
    '<span class="card-domain">' + esc(site.domain) + "</span>" +
    '<p class="card-desc">' + esc(description) + "</p>" +
    "</a>" +
    '<div class="card-corner">' +
    '<span class="corner-stat" title="跳转次数 ' + num(site.jumps) + '">' +
    jumpIcon() + compact(site.jumps) +
    "</span></div>" +
    (category ? '<div class="card-cat-row">' + category + "</div>" : "") +
    '<div class="card-bottom"><div class="card-tags"><div class="tag-track">' + aiTag + tags + "</div></div>" +
    detail +
    "</div></article>"
  );
}

/** 标签轮播的恒定速度（px/s）：取原 ease-in-out 往返动画中点峰值 20 × 1.724 ≈ 34.5 */
const TAG_SCROLL_SPEED = 34.5;
/** 位移极小时的最短时长，避免来回抖动得像闪屏 */
const TAG_SCROLL_MIN_SECONDS = 0.9;

/** 标签是否真的装不下：只有装不下才启用轮播；每次重新判定，避免字体/宽度变化后残留旧结论 */
function measureCardTags(card: HTMLElement): void {
  const box = card.querySelector<HTMLElement>(".card-tags");
  const track = box?.querySelector<HTMLElement>(".tag-track");
  if (!box || !track) return;
  const visible = box.getBoundingClientRect().width;
  if (visible <= 0) return; // 布局还没完成，等下一次测量
  const content = Math.max(track.getBoundingClientRect().width, track.scrollWidth);
  const overflow = Math.ceil(content - visible);
  if (overflow > 1) {
    const distance = overflow + 4;
    box.classList.add("is-overflow");
    box.style.setProperty("--tag-shift", "-" + distance + "px");
    // linear + 时长 = 距离 / 速度 → 全程恒速（不再两头慢中间快）
    box.style.setProperty("--tag-duration", Math.max(TAG_SCROLL_MIN_SECONDS, distance / TAG_SCROLL_SPEED).toFixed(2) + "s");
  } else {
    box.classList.remove("is-overflow");
    box.style.removeProperty("--tag-shift");
    box.style.removeProperty("--tag-duration");
  }
}

function refreshCardTags(): void {
  document.querySelectorAll<HTMLElement>(".card").forEach(measureCardTags);
}

function prepareCardEnhancements(): void {
  document.querySelectorAll<HTMLElement>(".card").forEach((card) => {
    const desc = card.querySelector<HTMLElement>(".card-desc");
    if (desc && desc.scrollHeight > desc.clientHeight + 1) {
      card.title = desc.textContent ?? "";
    }
    measureCardTags(card);
  });
  // 字体加载/首次布局可能改变宽度，下一帧再复测一次
  requestAnimationFrame(refreshCardTags);
}

/** 标签栏最多展示 3 行，超出折叠并显示「展开全部」；按真实换行位置测量，不依赖固定行高 */
const TAG_BAR_ROWS = 3;
let tagsExpanded = false;

/** 字体加载、窗口缩放、横竖屏切换后重新判定，保证“装不下才轮播”始终成立 */
function watchCardTagOverflow(): void {
  let frame = 0;
  const schedule = (): void => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      refreshCardTags();
      setupTagsBar();
    });
  };
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("orientationchange", schedule, { passive: true });
  if (document.fonts) void document.fonts.ready.then(schedule);
}

/** 标签栏最多展示 3 行，超出折叠，并把「展开剩余」按钮插在第三行末尾；按真实换行位置测量 */
function setupTagsBar(): void {
  const list = document.querySelector<HTMLElement>("[data-tags-list]");
  const toggle = document.querySelector<HTMLButtonElement>('[data-action="toggle-tags"]');
  if (!list || !toggle) return;

  // 按钮先挂回列表末尾并隐藏，保证测量时不影响换行
  if (toggle.parentElement !== list) list.appendChild(toggle);
  toggle.hidden = true;
  const tags = (Array.from(list.children) as HTMLElement[]).filter((el) => el !== toggle);
  if (!tags.length) return;

  // 先解除折叠再测量，避免上一次的 max-height 影响换行结果
  list.style.maxHeight = "none";
  const tops: number[] = [];
  for (const tag of tags) {
    if (!tops.includes(tag.offsetTop)) tops.push(tag.offsetTop);
  }
  tops.sort((a, b) => a - b);

  if (tops.length <= TAG_BAR_ROWS) {
    tagsExpanded = false;
    list.style.maxHeight = "";
    toggle.textContent = "展开全部";
    toggle.setAttribute("aria-expanded", "false");
    return;
  }

  const foldTop = tops[TAG_BAR_ROWS - 1];

  if (tagsExpanded) {
    // 展开后把「收起」放到最后一个标签之后
    toggle.textContent = "收起";
    toggle.setAttribute("aria-expanded", "true");
    toggle.hidden = false;
    list.appendChild(toggle);
    list.style.maxHeight = list.scrollHeight + "px";
    return;
  }

  // 折叠：按钮插到第三行最后一个标签之后；这一行放不下就往前挪一个标签再试
  let index = tags.length - 1;
  while (index > 0 && tags[index].offsetTop !== foldTop) index -= 1;
  const label = (at: number): string => "展开剩余 " + num(tags.length - at - 1) + " 个";
  toggle.hidden = false;
  toggle.setAttribute("aria-expanded", "false");
  toggle.textContent = label(index);
  tags[index].after(toggle);
  let guard = 0;
  while (toggle.offsetTop > foldTop && index > 0 && guard < 60) {
    guard += 1;
    index -= 1;
    toggle.textContent = label(index);
    tags[index].after(toggle);
  }

  let foldBottom = 0;
  for (const el of Array.from(list.children) as HTMLElement[]) {
    if (el.offsetTop === foldTop) foldBottom = Math.max(foldBottom, el.offsetTop + el.offsetHeight);
  }
  list.style.maxHeight = foldBottom - tops[0] + 1 + "px";
}

function renderRightRail(nav: NavPayload): string {
  const hot = [...nav.sites].sort((a, b) => b.jumps - a.jumps).slice(0, 5);
  const totalSiteJumps = nav.sites.reduce((sum, site) => sum + site.jumps, 0);
  return (
    '<aside class="right-rail" aria-label="站点动态">' +
    '<section class="rail-section"><h2 class="rail-title">最近评论</h2>' +
    '<div class="rail-comment-list" id="recent-comments"><p class="rail-empty">加载中…</p></div></section>' +
    '<section class="rail-section"><h2 class="rail-title">热门站点</h2><div class="rail-hot-list">' +
    hot
      .map(
        (site, index) =>
          '<a class="rail-hot-row" href="/site/' + encodeURIComponent(site.slug) + '" data-link>' +
          '<span class="rail-rank">' + String(index + 1).padStart(2, "0") + "</span>" +
          '<span class="rail-site">' + esc(site.name) + "</span>" +
          '<span class="rail-views" title="跳转次数">' + jumpIcon() + compact(site.jumps) + "</span></a>",
      )
      .join("") +
    "</div></section>" +
    '<section class="rail-section"><h2 class="rail-title">站点概览</h2><div class="rail-stats">' +
    "<span><b>" + num(nav.stats.totalSites) + "</b>站点</span>" +
    "<span><b>" + num(totalSiteJumps) + "</b>站点跳转</span>" +
    "<span><b>" + num(nav.stats.totalComments) + "</b>评论</span>" +
    "</div></section>" +
    '<button type="button" class="rail-random" data-action="random-site">随机逛一个</button>' +
    "</aside>"
  );
}

async function loadRecentComments(): Promise<void> {
  const box = document.getElementById("recent-comments");
  if (!box) return;
  try {
    const data = await api<{ comments: RecentComment[] }>("/api/recent-comments?limit=4");
    if (!box.isConnected) return;
    if (!data.comments.length) {
      box.innerHTML = '<p class="rail-empty">还没有公开评论。</p>';
      return;
    }
    box.innerHTML = data.comments
      .map((comment) => {
        const base = comment.targetType === "page" ? "/page/" : "/site/";
        const href = base + encodeURIComponent(comment.targetSlug) + "#comment-" + comment.id;
        return (
          '<a class="rail-comment" href="' + href + '" data-link>' +
          '<span class="rail-comment-head"><b>' + esc(comment.author) + "</b><time>" + timeAgo(comment.createdAt) + "</time></span>" +
          '<span class="rail-comment-text">' + esc(comment.content) + "</span>" +
          '<span class="rail-comment-site">' + esc(comment.targetName) + "</span></a>"
        );
      })
      .join("");
  } catch {
    if (box.isConnected) box.innerHTML = '<p class="rail-empty">评论加载失败。</p>';
  }
}

function renderHome(): void {
  const nav = state.nav;
  if (!nav) return;

  const params = new URLSearchParams(location.search);
  const selectedSlug = params.get("cat");
  const selected = findCategory(nav.categories, selectedSlug);
  const activeSlug = selected?.slug ?? null;
  const search = (params.get("q") ?? "").trim();
  const activeTag = params.get("tag") ?? "";
  const requestedSort = params.get("sort");
  const sort: SortMode = parseSort(requestedSort);
  const dir: SortDir = parseSortDir(params.get("dir"), sort);
  const flat = flattenCategories(nav.categories);
  const scope = selected ? descendantIds(flat, selected.id) : null;
  const needle = search.toLowerCase();

  const filtered = nav.sites.filter((site) => {
    if (scope && !scope.has(site.categoryId)) return false;
    if (activeTag && !site.tags.includes(activeTag)) return false;
    if (!needle) return true;
    return [site.name, site.description, site.domain, site.categoryName, ...site.tags]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });

  filtered.sort((a, b) => {
    let diff: number;
    if (sort === "name") diff = a.name.localeCompare(b.name, "zh-CN");
    else if (sort === "jumps") diff = a.jumps - b.jumps;
    else diff = a.id - b.id;
    // 主键相同用 id 兜底，保证升/降序切换时顺序稳定不跳动
    if (diff === 0) diff = a.id - b.id;
    return dir === "asc" ? diff : -diff;
  });

  const jumps = filtered.reduce((sum, site) => sum + site.jumps, 0);
  const shown = filtered.slice(0, state.more);
  const hasFilters = Boolean(activeSlug || search || activeTag);
  const metaDescription = selected
    ? selected.description || nav.settings.siteDescription
    : nav.settings.siteDescription;

  // 每个按钮都带方向箭头：当前按钮显示实际方向（再点一次反转），其余显示各自默认方向
  const sortButton = (value: SortMode, label: string) => {
    const active = sort === value;
    const shown: SortDir = active ? dir : defaultSortDir(value);
    const title = active
      ? dir === "asc"
        ? "当前升序，点击改为降序"
        : "当前降序，点击改为升序"
      : "按" + label + (defaultSortDir(value) === "asc" ? "升序" : "降序") + "排序";
    return (
      '<button type="button" class="sort-btn' + (active ? " active" : "") + '"' +
      ' data-action="sort" data-value="' + value + '"' +
      ' aria-pressed="' + (active ? "true" : "false") + '" title="' + title + '">' +
      label + '<span class="sort-dir' + (shown === "asc" ? " is-asc" : "") + '" aria-hidden="true"></span></button>'
    );
  };

  // 标签栏全量渲染（服务端已按次数降序排好），每个标签后带半角括号的使用次数；
  // 超过 3 行由 setupTagsBar() 折叠，并显示「展开全部」
  const tagLinks = nav.tags
    .map((tag) => {
      const active = tag.name === activeTag;
      return '<a class="tag' + (active ? " active" : "") + '" href="' +
        esc(homeHref({ tag: active ? null : tag.name })) +
        '" data-link>' + esc(tag.name) + '<span class="tag-count">(' + num(tag.count) + ")</span></a>";
    })
    .join("");

  const tagsBar = tagLinks
    ? '<div class="tags-bar"><span class="tags-bar__label">标签</span>' +
      '<div class="tags-bar__body">' +
      '<div class="tags-bar__list" data-tags-list>' + tagLinks + "</div>" +
      '<button type="button" class="tags-bar__toggle" data-action="toggle-tags" aria-expanded="false" hidden>展开全部</button>' +
      "</div></div>"
    : "";

  const cards = shown.map((site) => renderCard(site, !selected)).join("");

  const main =
    '<div class="wrap home-wrap"><div class="layout">' +
    renderSidebar(nav.categories, activeSlug, nav.stats.totalSites) +
    '<section class="content">' +
    '<div class="toolbar">' +
    '<div class="sort-box"><span class="sort-label">排序</span><div class="sort-options">' +
    sortButton("manual", "时间") + sortButton("name", "名称") + sortButton("jumps", "跳转") +
    "</div></div>" +
    '<form class="search" data-search><input type="search" name="q" value="' + esc(search) + '" placeholder="搜索站点、描述或标签" aria-label="搜索站点"><button type="submit">搜索</button></form>' +
    "</div>" +
    tagsBar +
    '<div class="result-meta"><span>共 <b>' + num(filtered.length) + "</b> 个站点 · " + num(jumps) + " 次跳转" + (hasFilters ? " · 已筛选" : "") + "</span>" +
    (hasFilters ? '<a class="link-btn" href="/" data-link>清除筛选</a>' : "") +
    "</div>" +
    (filtered.length === 0
      ? '<div class="empty"><h2>没有找到匹配的站点</h2><p>换个关键词，或回到全部站点看看。</p><a class="btn small" href="/" data-link>查看全部</a></div>'
      : '<div class="grid">' + cards + "</div>") +
    (shown.length < filtered.length
      ? '<div class="more-row"><button type="button" class="btn" data-action="more">显示更多（剩余 ' + num(filtered.length - shown.length) + " 个）</button></div>"
      : "") +
    "</section>" +
    renderRightRail(nav) +
    "</div></div>";

  shell(main, selected ? selected.name + " - " + nav.settings.siteName : nav.settings.siteName, metaDescription);
  prepareCardEnhancements();
  setupTagsBar();
  // 字体加载后行高可能微调，下一帧复测一次
  requestAnimationFrame(() => setupTagsBar());
  void loadRecentComments();
}



function renderCommentItem(comment: PublicComment): string {
  const author = comment.website
    ? '<a class="comment-author" href="' + esc(comment.website) + '" target="_blank" rel="noopener noreferrer nofollow ugc">' + esc(comment.author) + "</a>"
    : '<b class="comment-author">' + esc(comment.author) + "</b>";
  // IP 属地只到省份，跟中文互联网的通行做法一致
  const region = comment.ipProvince
    ? '<span class="comment-ip">IP属地：' + esc(comment.ipProvince) + "</span>"
    : "";
  return (
    '<article class="comment" id="comment-' + comment.id + '">' +
    '<span class="comment-avatar">' + esc(initialOf(comment.author)) + "</span>" +
    '<div class="comment-body"><header>' + author +
    '<a class="comment-time" href="#comment-' + comment.id + '"><time>' + timeAgo(comment.createdAt) + "</time></a>" + region +
    "</header>" +
    "<p>" + esc(comment.content) + "</p></div></article>"
  );
}

function renderCommentsBox(cs: CommentState): void {
  if (state.comments !== cs) return;
  const box = document.getElementById("comments-box");
  if (!box) return;
  const nav = state.nav;
  const enabled = nav?.settings.commentsEnabled ?? true;
  const moderation = nav?.settings.commentModeration ?? true;
  const captcha =
    cs.captcha && !cs.captchaError
      ? '<span class="captcha-question">验证：' + esc(cs.captcha.question) + '</span>' +
        '<button type="button" class="link-btn" data-action="refresh-captcha">换一题</button>' +
        '<input type="number" name="answer" required value="' + esc(cs.values.answer) + '" placeholder="答案" aria-label="验证码答案">'
      : '<span class="form-msg">' + esc(cs.captchaError || "验证码加载中…") + '</span>' +
        '<button type="button" class="link-btn" data-action="refresh-captcha">重试</button>';
  const form = enabled
    ? '<form class="comment-form" data-comment-form>' +
      '<div class="row"><input type="text" name="author" required maxlength="24" placeholder="你的称呼" value="' + esc(cs.values.author) + '">' +
      '<input type="email" name="email" required maxlength="120" placeholder="邮箱（必填，不公开）" value="' + esc(cs.values.email) + '">' +
      '<input type="text" name="website" maxlength="300" inputmode="url" placeholder="个人网址（选填）" value="' + esc(cs.values.website) + '"></div>' +
      '<textarea name="content" required minlength="5" maxlength="800" placeholder="写下你的使用体验或补充（5-800 字）">' + esc(cs.values.content) + "</textarea>" +
      '<input class="hp" type="text" name="company" tabindex="-1" autocomplete="off" aria-hidden="true">' +
      '<div class="captcha-row">' + captcha +
      '<button type="submit" class="btn primary small"' + (cs.busy || !cs.captcha ? " disabled" : "") + ">" + (cs.busy ? "提交中…" : "发表评论") + "</button></div>" +
      (cs.notice ? '<p class="form-msg ok">' + esc(cs.notice) + "</p>" : "") +
      (cs.error ? '<p class="form-msg">' + esc(cs.error) + "</p>" : "") +
      '<p class="comment-note">' + (moderation ? "审核后展示 · " : "") + "邮箱不会公开；评论会展示 IP 属地省份。</p>" +
      "</form>"
    : '<p class="comment-note">评论功能暂时关闭。</p>';
  const list = cs.comments.length
    ? '<div class="comment-list">' + cs.comments.map(renderCommentItem).join("") + "</div>"
    : '<p class="comments-empty">还没有评论。</p>';
  const more =
    cs.comments.length < cs.total
      ? '<div class="comments-more"><button type="button" class="btn small" data-action="load-comments"' +
        (cs.loadingMore ? " disabled" : "") +
        ">" + (cs.loadingMore ? "加载中…" : "加载更多评论（" + (cs.total - cs.comments.length) + "）") + "</button></div>"
      : "";
  box.innerHTML =
    '<div class="comments-head"><h2>评论</h2><small>' + num(cs.total) + " 条" + (moderation ? " · 审核后展示" : "") + "</small></div>" +
    form +
    (cs.error && !enabled ? '<p class="form-msg">' + esc(cs.error) + "</p>" : "") +
    list +
    more;
  if (location.hash.startsWith("#comment-") || location.hash === "#comments-box") {
    requestAnimationFrame(scrollToCommentHash);
  }
}

function scrollToCommentHash(): void {
  const hash = location.hash;
  if (!hash) return;
  const target = document.getElementById(hash.slice(1));
  if (target) target.scrollIntoView({ block: "center" });
}

async function fetchCaptcha(cs: CommentState): Promise<void> {
  try {
    cs.captcha = await api<CaptchaChallenge>("/api/captcha");
    cs.captchaError = "";
  } catch (error) {
    cs.captcha = null;
    cs.captchaError = error instanceof Error ? error.message : "验证码加载失败";
  }
}

async function loadCommentPage(cs: CommentState, page: number, append: boolean): Promise<void> {
  if (state.comments !== cs) return;
  if (append) cs.loadingMore = true;
  try {
    const base =
      (cs.targetType === "site" ? "/api/sites/" : "/api/pages/") + encodeURIComponent(cs.targetSlug) + "/comments";
    const data = await api<CommentsPayload>(base + "?page=" + page + "&pageSize=20");
    if (state.comments !== cs) return;
    cs.comments = append ? cs.comments.concat(data.comments) : data.comments;
    cs.total = data.total;
    cs.page = data.page;
    if (append) cs.error = "";
  } catch (error) {
    if (state.comments === cs) cs.error = error instanceof Error ? error.message : "评论加载失败";
  } finally {
    if (state.comments === cs) {
      cs.loadingMore = false;
      renderCommentsBox(cs);
    }
  }
}

async function initComments(target: { type: "site" | "page"; slug: string }): Promise<void> {
  const seq = ++state.commentSeq;
  const nav = state.nav;
  if (!nav) return;
  const enabled = nav.settings.commentsEnabled;
  let author = "";
  try {
    author = localStorage.getItem("iNav-comment-name") ?? "";
  } catch {
    author = "";
  }
  const cs: CommentState = {
    targetType: target.type,
    targetSlug: target.slug,
    page: 1,
    total: 0,
    comments: [],
    captcha: null,
    captchaError: "",
    startedAt: Date.now(),
    loadingMore: false,
    busy: false,
    notice: "",
    error: "",
    values: { author, email: "", website: "", content: "", answer: "" },
  };
  state.comments = cs;
  const commentBase =
    (target.type === "site" ? "/api/sites/" : "/api/pages/") + encodeURIComponent(target.slug) + "/comments";
  try {
    const list = await api<CommentsPayload>(commentBase + "?page=1&pageSize=20");
    if (state.commentSeq !== seq || state.comments !== cs) return;
    cs.comments = list.comments;
    cs.total = list.total;
    cs.page = list.page;
  } catch (error) {
    if (state.comments !== cs) return;
    cs.error = error instanceof Error ? error.message : "评论加载失败";
  }
  if (enabled) await fetchCaptcha(cs);
  if (state.commentSeq !== seq || state.comments !== cs) return;
  renderCommentsBox(cs);
}

async function submitComment(form: HTMLFormElement): Promise<void> {
  const cs = state.comments;
  if (!cs || cs.busy) return;
  const data = new FormData(form);
  cs.values.author = String(data.get("author") ?? "").trim();
  cs.values.email = String(data.get("email") ?? "").trim();
  cs.values.website = String(data.get("website") ?? "").trim();
  cs.values.content = String(data.get("content") ?? "").trim();
  cs.values.answer = String(data.get("answer") ?? "").trim();
  cs.notice = "";
  cs.error = "";
  if (!cs.captcha) {
    cs.error = "验证码尚未加载完成";
    renderCommentsBox(cs);
    return;
  }
  if (!cs.values.author || !cs.values.email || cs.values.content.length < 5) {
    cs.error = "请填写称呼、邮箱和至少 5 个字的评论";
    renderCommentsBox(cs);
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cs.values.email)) {
    cs.error = "请填写有效的邮箱地址";
    renderCommentsBox(cs);
    return;
  }
  cs.busy = true;
  renderCommentsBox(cs);
  try {
    const commentBase =
      (cs.targetType === "site" ? "/api/sites/" : "/api/pages/") + encodeURIComponent(cs.targetSlug) + "/comments";
    const result = await api<CommentSubmitResult>(commentBase, {
      method: "POST",
      body: JSON.stringify({
        author: cs.values.author,
        email: cs.values.email,
        website: cs.values.website,
        content: cs.values.content,
        company: String(data.get("company") ?? ""),
        captchaToken: cs.captcha.token,
        captchaAnswer: Number(cs.values.answer),
        startedAt: cs.startedAt,
      }),
    });
    if (state.comments !== cs) return;
    cs.notice = result.message;
    cs.values.content = "";
    cs.values.answer = "";
    cs.startedAt = Date.now();
    try {
      localStorage.setItem("iNav-comment-name", cs.values.author);
    } catch {
      // ignore
    }
    await loadCommentPage(cs, 1, false);
    await fetchCaptcha(cs);
  } catch (error) {
    if (state.comments !== cs) return;
    cs.error = error instanceof Error ? error.message : "评论提交失败";
    await fetchCaptcha(cs);
  } finally {
    if (state.comments === cs) {
      cs.busy = false;
      renderCommentsBox(cs);
    }
  }
}

function renderSitePage(slug: string, seq: number): Promise<void> {
  return (async () => {
    shell('<div class="wrap"><div class="empty">正在加载站点…</div></div>', "加载中");
    try {
      const site = await api<SiteDetail>("/api/sites/" + encodeURIComponent(slug));
      if (seq !== state.routeSeq) return;
      const shot = screenshotFor(site);
      const related = (state.nav?.sites ?? [])
        .filter((item) => item.categoryId === site.categoryId && item.id !== site.id)
        .slice(0, 6);
      const trail = site.categoryPath
        .map((category, index) =>
          index === site.categoryPath.length - 1
            ? esc(category.name)
            : '<a href="' + esc(homeHref({ cat: category.slug, q: null, tag: null })) + '" data-link>' + esc(category.name) + "</a>",
        )
        .join(" / ");
      const article = site.detailContent
        ? renderMarkdown(site.detailContent)
        : '<p class="comment-note">这个站点还没有补充更多介绍。</p>';
      const shotBlock =
        '<figure class="shot">' +
        (shot.src
          ? '<img class="shot-img" src="' + esc(shot.src) + '"' +
            (shot.fallback ? ' data-fallback-src="' + esc(shot.fallback) + '"' : "") +
            ' alt="' + esc(site.name) + ' 网站截图" loading="eager" referrerpolicy="no-referrer" data-shot>'
          : "") +
        '<div class="shot-fallback"' + (shot.src ? " hidden" : "") + ">截图暂不可用</div>" +
        "<figcaption>" + (shot.automatic ? "网站截图由免费截图 API 自动生成，首次可能较慢。" : "") + "</figcaption></figure>";
      const main =
        '<div class="wrap"><div class="detail-wrap">' +
        '<div class="breadcrumb"><a href="/" data-link>全部</a> / ' + trail + "</div>" +
        '<div class="detail-top">' +
        '<span class="site-icon lg"><span class="fallback">' + esc(initialOf(site.name)) + "</span>" +
        (faviconFor(site) ? '<img src="' + esc(faviconFor(site)) + '" alt="" referrerpolicy="no-referrer" data-icon>' : "") +
        "</span>" +
        '<div class="detail-head"><div class="detail-title-row"><h1 class="detail-title">' + esc(site.name) + "</h1>" +
        '<div class="detail-badges">' +
        detailBadge(jumpIcon(), "网站跳转次数", "<b>" + num(site.jumps) + "</b> 次跳转", "跳转 <b>" + num(site.jumps) + "</b>") +
        detailBadge(eyeIcon(), "该详情页被浏览的次数", "该页被浏览 <b>" + num(site.views) + "</b> 次", "浏览 <b>" + num(site.views) + "</b>") +
        detailBadge("", "收录日期", "收录于 " + formatDate(site.createdAt), "收录 " + formatDate(site.createdAt)) +
        "</div></div>" +
        '<a class="detail-domain" href="' + esc(site.url) + '" target="_blank" rel="noopener noreferrer" data-site-jump="' + site.id + '">' + esc(site.domain) + "</a>" +
        "</div>" +
        '<div class="detail-actions"><a class="btn primary" href="' + esc(site.url) + '" target="_blank" rel="noopener noreferrer" data-site-jump="' + site.id + '">访问网站</a>' +
        '<button type="button" class="btn" data-action="copy-link">复制链接</button></div>' +
        '<p class="detail-desc">' + esc(site.description) +
        (site.aiGenerated ? '<span class="tag detail-ai" title="简介由 AI 生成">AI 生成</span>' : "") + "</p>" +
        (site.tags.length
          ? '<div class="detail-tags">' +
            site.tags.map((tag) => '<a class="tag" href="' + esc(tagHref(tag)) + '" data-link>' + esc(tag) + "</a>").join("") + "</div>"
          : "") +
        "</div>" +
        shotBlock +
        '<section class="article"><h2>关于 ' + esc(site.name) + '</h2><div class="markdown">' + article + "</div></section>" +
        (related.length
          ? '<section class="related"><h2>同分类站点</h2><div class="related-list">' +
            related.map((item) => '<a href="' + esc(item.url) + '" target="_blank" rel="noopener noreferrer" data-site-jump="' + item.id + '">' + esc(item.name) + "</a>").join("") +
            "</div></section>"
          : "") +
        '<section class="comments" id="comments-box"><p class="comments-empty">评论加载中…</p></section>' +
        "</div></div>";
      shell(main, site.name + " - " + (state.nav?.settings.siteName ?? "锦囊书签"), site.description);
      trackView("site", site.id);
      void initComments({ type: "site", slug: site.slug });
    } catch {
      if (seq !== state.routeSeq) return;
      renderNotFound("没有找到这个站点", "它可能没有开启独立介绍页，或者已经被移除。");
    }
  })();
}



async function renderAbout(): Promise<void> {
  const nav = state.nav;
  if (!nav) return;
  const s = nav.settings;
  // 关于页的正文存在 pages 里（slug=about），在后台「页面」里编辑
  let page: PublicPage;
  try {
    page = await api<PublicPage>("/api/pages/about");
  } catch {
    renderNotFound("没有找到关于页", "它可能已被删除，或尚未发布。");
    return;
  }
  const main =
    '<div class="wrap"><div class="page-wrap">' +
    '<h1 class="page-title">' + esc(s.siteName) + "</h1>" +
    '<p class="page-desc">' + esc(s.siteTagline) + "</p>" +
    '<div class="about-stats">' +
    '<div class="about-stat"><b>' + num(nav.stats.totalSites) + '</b><span>收录站点</span></div>' +
    '<div class="about-stat"><b>' + num(nav.stats.totalComments) + '</b><span>公开评论</span></div>' +
    '<div class="about-stat"><b>' + num(nav.stats.totalViews) + '</b><span>全站浏览</span></div>' +
    '<div class="about-stat"><b>' + num(nav.stats.totalJumps) + '</b><span>全站跳转</span></div>' +
    '<div class="about-stat"><b>' + num(nav.stats.todayViews) + '</b><span>今日浏览</span></div>' +
    '<div class="about-stat"><b>' + num(nav.stats.todayJumps) + '</b><span>今日跳转</span></div></div>' +
    '<div class="markdown">' + renderMarkdown(page.content) + "</div>" +
    "</div></div>";
  shell(main, "关于 - " + s.siteName, s.siteDescription);
  trackView("page", page.id);
}

async function renderStandalonePage(slug: string, seq: number): Promise<void> {
  shell('<div class="wrap"><div class="empty">正在加载页面…</div></div>', "加载中");
  try {
    const page = await api<PublicPage>("/api/pages/" + encodeURIComponent(slug));
    if (seq !== state.routeSeq) return;
    const main =
      '<div class="wrap"><div class="page-wrap">' +
      '<h1 class="page-title">' + esc(page.title) + "</h1>" +
      '<div class="page-meta"><span>更新于 ' + formatDate(page.updatedAt) + "</span>" +
      "<span>该页被浏览 <b>" + num(page.views) + "</b> 次</span></div>" +
      (page.excerpt ? '<p class="page-desc">' + esc(page.excerpt) + "</p>" : "") +
      '<div class="markdown">' + renderMarkdown(page.content) + "</div>" +
      '<section class="comments" id="comments-box"><p class="comments-empty">评论加载中…</p></section>' +
      "</div></div>";
    shell(main, page.title + " - " + (state.nav?.settings.siteName ?? "锦囊书签"), page.excerpt);
    trackView("page", page.id);
    void initComments({ type: "page", slug: page.slug });
  } catch {
    if (seq !== state.routeSeq) return;
    renderNotFound("没有找到这个页面", "它可能尚未发布，或者地址已经改变。");
  }
}

function renderNotFound(title = "页面不存在", note = "这个地址没有对应的内容。"): void {
  shell(
    '<div class="wrap"><div class="page-wrap"><div class="error-box"><h1 class="page-title">' + esc(title) + "</h1><p>" +
      esc(note) +
      '</p><a class="btn" href="/" data-link>返回首页</a></div></div></div>',
    title,
  );
}



function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

document.addEventListener("click", (event) => {
  const target = event.target as Element;
  const siteLink = target.closest<HTMLAnchorElement>("a[data-site-jump]");
  if (siteLink && event.button === 0) trackJump(Number(siteLink.dataset.siteJump));
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = target.closest<HTMLAnchorElement>("a[data-link]");
  if (link) {
    const href = link.getAttribute("href");
    if (href && href.startsWith("/")) {
      event.preventDefault();
      navigate(href);
    }
    return;
  }
  const control = target.closest<HTMLElement>("[data-action]");
  if (!control) return;
  const action = control.dataset.action;
  if (action === "theme") {
    applyTheme(state.theme === "dark" ? "light" : "dark");
    return;
  }
  if (action === "open-cats") {
    setDrawer(true);
    return;
  }
  if (action === "close-cats") {
    setDrawer(false);
    return;
  }
  if (action === "reload-nav") {
    void boot();
    return;
  }
  if (action === "toggle-cat") {
    const id = Number(control.dataset.id);
    if (!Number.isFinite(id)) return;
    if (state.expanded.has(id)) state.expanded.delete(id);
    else state.expanded.add(id);
    if (location.pathname === "/") renderHome();
    return;
  }
  if (action === "sort" && location.pathname === "/") {
    const value = control.dataset.value;
    if (value === "manual" || value === "name" || value === "jumps") {
      const params = new URLSearchParams(location.search);
      const current = parseSort(params.get("sort"));
      const currentDir = parseSortDir(params.get("dir"), current);
      // 点当前按钮反转方向，点其他按钮回到该维度默认方向
      const nextDir: SortDir =
        current === value ? (currentDir === "asc" ? "desc" : "asc") : defaultSortDir(value);
      navigate(
        homeHref({
          sort: value === "manual" ? null : value,
          dir: nextDir === defaultSortDir(value) ? null : nextDir,
        }),
      );
    }
    return;
  }
  if (action === "more") {
    state.more += 120;
    renderHome();
    return;
  }
  if (action === "toggle-tags") {
    tagsExpanded = !tagsExpanded;
    setupTagsBar();
    return;
  }
  if (action === "random-site") {
    const sites = state.nav?.sites ?? [];
    if (sites.length) {
      const site = sites[Math.floor(Math.random() * sites.length)];
      navigate("/site/" + encodeURIComponent(site.slug));
    }
    return;
  }
  if (action === "copy-link") {
    void navigator.clipboard
      .writeText(location.href)
      .then(() => {
        control.textContent = "已复制";
        window.setTimeout(() => {
          control.textContent = "复制链接";
        }, 1600);
      })
      .catch(() => {
        control.textContent = "复制失败";
      });
    return;
  }
  if (action === "refresh-captcha" && state.comments) {
    const cs = state.comments;
    void fetchCaptcha(cs).then(() => renderCommentsBox(cs));
    return;
  }
  if (action === "load-comments" && state.comments) {
    const cs = state.comments;
    if (!cs.loadingMore) void loadCommentPage(cs, cs.page + 1, true);
  }
});

document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.matches("[data-search]")) {
    event.preventDefault();
    const value = String(new FormData(form).get("q") ?? "").trim();
    navigate(homeHref({ q: value || null }));
    return;
  }
  if (form.matches("[data-comment-form]")) {
    event.preventDefault();
    void submitComment(form);
  }
});

document.addEventListener("input", (event) => {
  const cs = state.comments;
  if (!cs) return;
  const target = event.target;
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return;
  if (!target.form?.matches("[data-comment-form]")) return;
  const name = target.name;
  if (name === "author" || name === "content" || name === "answer") {
    cs.values[name] = target.value;
  }
});

document.addEventListener(
  "error",
  (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    if (image.matches("[data-icon]")) {
      image.style.display = "none";
    }
    if (image.matches("[data-shot]")) {
      const fallbackSrc = image.dataset.fallbackSrc;
      if (fallbackSrc) {
        delete image.dataset.fallbackSrc;
        image.src = fallbackSrc;
        return;
      }
      image.style.display = "none";
      const fallback = image.parentElement?.querySelector(".shot-fallback");
      fallback?.removeAttribute("hidden");
    }
  },
  true,
);

document.addEventListener("auxclick", (event) => {
  if (event.button !== 1) return;
  const link = (event.target as Element).closest<HTMLAnchorElement>("a[data-site-jump]");
  if (link) trackJump(Number(link.dataset.siteJump));
});

window.addEventListener("popstate", () => {
  state.more = 120;
  setDrawer(false);
  window.scrollTo(0, 0);
  void renderRoute();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setDrawer(false);
    return;
  }
  if (event.key === "/" && !isTypingTarget(event.target)) {
    const input = document.querySelector<HTMLInputElement>(".search input");
    if (input) {
      event.preventDefault();
      input.focus();
    }
  }
});

applyTheme(state.theme);
void boot();

