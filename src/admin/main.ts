import type {
  AdminCategory,
  AdminComment,
  AdminPage,
  AdminSettingsPayload,
  AdminSite,
  AdminTag,
  AdminTagsPayload,
  AuthConfig,
  AuthUser,
  LinkStatus,
  PaginatedAdminSites,
  SiteSettings,
} from "../../shared/types";
import { categoryIcon, isIconName, CATEGORY_ICON_GROUPS } from "../lib/categoryIcons";
import { AI_PROVIDER_PRESETS, AI_PROMPT_VARIABLES, DEFAULT_AI_PROMPT, aiProviderPreset } from "../../shared/ai";
import { formatDate, parseDbTime } from "../lib/datetime";
import { renderMarkdown } from "../lib/markdown";
import "../styles.css";

type Tab = "sites" | "categories" | "tags" | "pages" | "comments" | "settings";
type CommentFilter = "all" | "pending" | "approved" | "spam";

/* ---------- 分页参数（书签 / 标签共用） ---------- */

const DEFAULT_SITE_PAGE_SIZE = 18;
const DEFAULT_TAG_PAGE_SIZE = 25;
const DEFAULT_COMMENT_PAGE_SIZE = 14;
/** 0 表示“全部”，即不分页 */
const PAGE_SIZE_OPTIONS: number[] = [5, 10, 15, 18, 20, 25, 0];
/** 评论页单独一组：卡片比表格行高，14 条正好两列铺满 */
const COMMENT_PAGE_SIZE_OPTIONS: number[] = [6, 10, 14, 18, 20, 0];
const PAGE_SIZE_MAX = 500;
const SITE_PAGE_SIZE_KEY = "inav.admin.pageSize.sites";
const TAG_PAGE_SIZE_KEY = "inav.admin.pageSize.tags";
const COMMENT_PAGE_SIZE_KEY = "inav.admin.pageSize.comments";

/** 0 = 全部；其余夹在 1–500 之间 */
function normalizePageSize(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(PAGE_SIZE_MAX, Math.round(value));
}

/** 读 localStorage 里记住的每页条数，读不到或非法就回到该表自己的默认值 */
function storedPageSize(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return normalizePageSize(Number(raw));
  } catch {
    return fallback;
  }
}

function storePageSize(key: string, size: number): void {
  try {
    localStorage.setItem(key, String(size));
  } catch {
    // 隐私模式下写入可能失败，忽略即可，不影响当次使用
  }
}

interface State {
  user: AuthUser | null;
  config: AuthConfig | null;
  tab: Tab;
  categories: AdminCategory[];
  sites: AdminSite[];
  tags: AdminTag[];
  tagsTotalSites: number;
  pages: AdminPage[];
  comments: AdminComment[];
  settings: SiteSettings | null;
  aiKeys: Record<string, boolean>;
  /** 设置里是否已保存自定义接口的 API Key（接口不下发明文） */
  aiApiKeySet: boolean;
  githubOauthConfigured: boolean;
  siteQuery: string;
  siteCategory: number | null;
  sitePage: number;
  /** 书签每页条数，0 = 全部 */
  sitePageSize: number;
  siteName: string;
  commentFilter: CommentFilter;
  commentsTotal: number;
  commentPage: number;
  /** 评论每页条数，0 = 全部 */
  commentPageSize: number;
  tagQuery: string;
  tagSort: "count" | "name";
  tagSortDir: "asc" | "desc";
  tagEditing: string | null;
  tagSelected: Set<string>;
  tagPage: number;
  /** 标签每页条数，0 = 全部 */
  tagPageSize: number;
  busy: boolean;
}

const state: State = {
  user: null,
  config: null,
  tab: "sites",
  categories: [],
  sites: [],
  tags: [],
  tagsTotalSites: 0,
  pages: [],
  comments: [],
  settings: null,
  aiKeys: {},
  aiApiKeySet: false,
  githubOauthConfigured: false,
  siteQuery: "",
  siteCategory: null,
  sitePage: 1,
  sitePageSize: storedPageSize(SITE_PAGE_SIZE_KEY, DEFAULT_SITE_PAGE_SIZE),
  siteName: "锦囊书签",
  commentFilter: "pending",
  commentsTotal: 0,
  commentPage: 1,
  commentPageSize: storedPageSize(COMMENT_PAGE_SIZE_KEY, DEFAULT_COMMENT_PAGE_SIZE),
  tagQuery: "",
  tagSort: "count",
  tagSortDir: "desc",
  tagEditing: null,
  tagSelected: new Set<string>(),
  tagPage: 1,
  tagPageSize: storedPageSize(TAG_PAGE_SIZE_KEY, DEFAULT_TAG_PAGE_SIZE),
  busy: false,
};

const app = document.getElementById("root")!;
const $ = <T extends Element>(selector: string, scope: ParentNode = document) => scope.querySelector<T>(selector);
const $$ = <T extends Element>(selector: string, scope: ParentNode = document) => [...scope.querySelectorAll<T>(selector)];

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function num(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function shortDate(value: string): string {
  return formatDate(value);
}

function statusText(status: LinkStatus): string {
  return status === "alive" ? "正常" : status === "warn" ? "警告" : status === "dead" ? "失效" : "未检测";
}

async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : "请求失败";
    throw new Error(message);
  }
  return data as T;
}

function toast(message: string, kind: "ok" | "error" = "ok"): void {
  const el = document.createElement("div");
  el.className = "admin-toast " + kind;
  el.textContent = message;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 200);
  }, 2600);
}

function tabFromPath(): Tab {
  const path = location.pathname.replace(/\/+$/, "");
  if (path.endsWith("/categories")) return "categories";
  if (path.endsWith("/tags")) return "tags";
  if (path.endsWith("/pages")) return "pages";
  if (path.endsWith("/comments")) return "comments";
  if (path.endsWith("/settings")) return "settings";
  return "sites";
}

function pathForTab(tab: Tab): string {
  return "/admin/" + tab;
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "sites", label: "书签" },
  { id: "categories", label: "分类" },
  { id: "tags", label: "标签" },
  { id: "pages", label: "独立页面" },
  { id: "comments", label: "评论" },
  { id: "settings", label: "设置" },
];

function frame(content: string): void {
  const user = state.user;
  app.innerHTML =
    '<div class="admin-shell">' +
    '<header class="admin-top"><div class="admin-top__inner">' +
    '<a class="admin-brand" href="/admin/sites" data-admin-tab="sites"><span class="admin-brand__mark">' + esc(state.siteName.slice(0, 1) || "书") + '</span><span>' + esc(state.siteName) + " · 后台</span></a>" +
    '<a class="admin-link admin-top__front" href="/" target="_blank" rel="noopener">查看前台</a>' +
    '<div class="admin-top__actions">' +
    (user ? '<span class="admin-user">' + esc(user.name || user.login) + '</span><button type="button" class="admin-plain-btn" data-action="logout">退出</button>' : "") +
    "</div></div></header>" +
    '<div class="admin-layout"><aside class="admin-nav">' +
    TABS.map((tab) => '<a class="admin-nav__item' + (tab.id === state.tab ? " active" : "") + '" href="' + pathForTab(tab.id) + '" data-admin-tab="' + tab.id + '">' + tab.label + "</a>").join("") +
    "</aside><main class=\"admin-main\">" + content + "</main></div></div>";
  bindFrame();
}

function bindFrame(): void {
  $$<HTMLAnchorElement>("[data-admin-tab]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const tab = link.dataset.adminTab as Tab | undefined;
      if (tab) navigate(tab);
    });
  });
  $<HTMLElement>('[data-action="logout"]')?.addEventListener("click", logout);
}

function loading(): string {
  return '<div class="admin-loading">正在加载…</div>';
}

async function navigate(tab: Tab, push = true): Promise<void> {
  if (state.busy) return;
  state.tab = tab;
  if (push && location.pathname !== pathForTab(tab)) history.pushState({ tab }, "", pathForTab(tab));
  state.busy = true;
  frame(loading());
  try {
    if (tab === "sites") await loadSites();
    else if (tab === "categories") await loadCategories();
    else if (tab === "tags") await loadTags();
    else if (tab === "pages") await loadPages();
    else if (tab === "comments") await loadComments();
    else await loadSettings();
  } catch (error) {
    toast(error instanceof Error ? error.message : "加载失败", "error");
    frame('<div class="admin-empty">加载失败，请刷新重试。</div>');
  } finally {
    state.busy = false;
  }
}

async function boot(): Promise<void> {
  app.innerHTML = '<div class="admin-boot">正在加载…</div>';
  try {
    const config = await api<AuthConfig>("/api/auth/config");
    state.config = config;
    try {
      const me = await api<{ user: AuthUser | null }>("/api/auth/me");
      state.user = me.user;
    } catch {
      state.user = null;
    }
    if (!state.user) {
      renderLogin();
      return;
    }
    try {
      const nav = await api<{ settings: { siteName: string } }>("/api/nav");
      state.siteName = nav.settings.siteName || state.siteName;
    } catch {
      // keep the default brand if the public nav endpoint fails
    }
    if (location.pathname.replace(/\/+$/, "") === "/admin" || location.pathname === "/admin/") {
      history.replaceState(null, "", "/admin/sites");
    }
    await navigate(tabFromPath(), false);
  } catch {
    app.innerHTML = '<div class="admin-empty">无法连接后台接口，请稍后刷新。</div>';
  }
}

function renderLogin(): void {
  const config = state.config;
  const params = new URLSearchParams(location.search);
  const error = params.get("error");
  app.innerHTML =
    '<div class="login-shell"><a class="login-back" href="/">← 返回前台</a><section class="login-card">' +
    '<span class="login-eyebrow">ADMIN</span><h1>锦囊书签后台</h1><p>维护书签、分类、页面、评论和站点设置。</p>' +
    (error ? '<p class="admin-error">登录失败：' + esc(error) + "</p>" : "") +
    (config?.githubEnabled
      ? '<a class="admin-button admin-button--primary login-github" href="/api/auth/github">使用 GitHub 登录</a>'
      : '<p class="admin-muted">GitHub OAuth 尚未配置。</p>') +
    '<p class="login-note">修改会立即写入 D1 数据库。</p></section></div>';
}

async function logout(): Promise<void> {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    // logout even if the endpoint fails
  }
  state.user = null;
  renderLogin();
}

function pageHead(title: string, note: string, actions = ""): string {
  return '<div class="admin-page-head"><div><h1>' + esc(title) + '</h1>' + (note ? '<p>' + esc(note) + "</p>" : "") + "</div>" + (actions ? '<div class="admin-actions">' + actions + "</div>" : "") + "</div>";
}

function button(label: string, action: string, kind = "default", id?: number): string {
  return '<button type="button" class="admin-button admin-button--' + kind + '" data-action="' + action + '"' + (id === undefined ? "" : ' data-id="' + id + '"') + ">" + esc(label) + "</button>";
}

/* ---------- sites ---------- */

async function loadSites(): Promise<void> {
  // 接口单页上限 100，超过时逐页取完，前端再按“每页条数”分页（搜索、筛选、拖拽都基于完整列表）
  const first = await api<PaginatedAdminSites>("/api/admin/sites?page=1&pageSize=100");
  let sites = first.sites;
  const remotePages = Math.min(Math.ceil(first.total / 100), 50);
  for (let page = 2; page <= remotePages; page += 1) {
    const next = await api<PaginatedAdminSites>("/api/admin/sites?page=" + page + "&pageSize=100");
    if (!next.sites.length) break;
    sites = sites.concat(next.sites);
  }
  state.sites = sites;
  if (!state.categories.length) await loadCategoryData();
  // 检测链接、AI 简介轮询都是「发起时在书签页，返回时用户可能已经切走」。
  // 这时再 frame(renderSites()) 会把书签表格画到别的 tab 内容区上，而导航高亮还停在原 tab，
  // 所以只有当前仍然停在书签页才重绘；数据已经写进 state.sites，切回来会照常重新加载。
  if (state.tab !== "sites") return;
  frame(renderSites());
  bindSites();
  // 刷新页面时如果还有书签在后台生成简介，继续盯着，完成后再刷一次表格
  for (const site of sites) {
    if (aiPendingVisible(site)) trackAiDescription(site.id);
  }
}

function siteFilterPickerHtml(): string {
  const items: CategoryPickerItem[] = [{ id: "", name: "全部分类", depth: 0, icon: null }, ...categoryPickerItems()];
  return '<span class="cat-filter" id="site-category-filter">' + categoryPickerHtml(items, state.siteCategory != null ? String(state.siteCategory) : "", "siteCategoryFilter") + "</span>";
}

function categoryFilterIds(categoryId: number): Set<number> {
  const ids = new Set<number>([categoryId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const category of state.categories) {
      if (category.parentId !== null && ids.has(category.parentId) && !ids.has(category.id)) {
        ids.add(category.id);
        changed = true;
      }
    }
  }
  return ids;
}

function siteRows(): AdminSite[] {
  const query = state.siteQuery.trim().toLowerCase();
  const categoryIds = state.siteCategory ? categoryFilterIds(state.siteCategory) : null;
  return state.sites.filter((site) => {
    if (categoryIds && !categoryIds.has(site.categoryId)) return false;
    if (!query) return true;
    return [site.name, site.url, site.categoryName, site.description, site.tags.join(" ")].join(" ").toLowerCase().includes(query);
  });
}

function siteInitial(site: AdminSite): string {
  return esc((site.name || "?").slice(0, 1).toUpperCase());
}

function sitePageCount(total: number): number {
  return pageCount(total, state.sitePageSize);
}

/** 按当前搜索/筛选结果切片，并把页码夹在有效范围内 */
function sitePageSlice(): { rows: AdminSite[]; total: number; page: number; pages: number; start: number } {
  const all = siteRows();
  const size = state.sitePageSize;
  const pages = pageCount(all.length, size);
  const page = Math.min(Math.max(1, state.sitePage), pages);
  state.sitePage = page;
  if (size === 0) return { rows: all, total: all.length, page: 1, pages: 1, start: 0 };
  const start = (page - 1) * size;
  return { rows: all.slice(start, start + size), total: all.length, page, pages, start };
}

/** 每页页数（size = 0 表示全部，只有 1 页） */
function pageCount(total: number, size: number): number {
  if (size === 0) return 1;
  return Math.max(1, Math.ceil(total / size));
}

function pageNumbers(page: number, pages: number): Array<number | "gap"> {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
  const items: Array<number | "gap"> = [1];
  const from = Math.max(2, page - 1);
  const to = Math.min(pages - 1, page + 1);
  if (from > 2) items.push("gap");
  for (let index = from; index <= to; index += 1) items.push(index);
  if (to < pages - 1) items.push("gap");
  items.push(pages);
  return items;
}

/** 数字输入框 + 右侧常显的上下箭头（原生 number 箭头只在悬停/聚焦时才出现，太容易看不见） */
function stepperHtml(inputHtml: string, label: string, wrapAttr = ""): string {
  return (
    '<span class="num-stepper"' + (wrapAttr ? " " + wrapAttr : "") + ">" +
    inputHtml +
    '<span class="num-stepper__arrows">' +
    '<button type="button" class="num-stepper__arrow" data-step="1" title="增加" aria-label="' + label + '增加"></button>' +
    '<button type="button" class="num-stepper__arrow" data-step="-1" title="减少" aria-label="' + label + '减少"></button>' +
    "</span>" +
    "</span>"
  );
}

/**
 * 每页条数下拉（自定义实现）：收起时数字居中、宽度贴合；展开的选项列表左对齐。
 * 原生 <select> 做不到——Chrome 会用选中 option 的 text-align 渲染收起态，只能自绘。
 */
function sizeSelectHtml(current: number, sizes: number[] = PAGE_SIZE_OPTIONS): string {
  const items = sizes.filter((size) => size !== 0).map((size) => ({ value: String(size), label: String(size) }));
  // 用户自定义的值（不在预设里）也补一项，保证收起态能显示
  if (!sizes.includes(current)) items.push({ value: String(current), label: String(current) });
  items.push({ value: "custom", label: "自定义" });
  items.push({ value: "0", label: "全部" });
  const currentValue = String(current);
  const currentLabel = current === 0 ? "全部" : currentValue;
  return (
    '<span class="size-select' + (current === 0 ? " is-wide" : "") + '" data-size-select>' +
    '<button type="button" class="size-select__trigger" data-size-trigger aria-haspopup="listbox" aria-expanded="false" aria-label="每页条数">' +
    currentLabel +
    "</button>" +
    '<div class="size-select__panel" data-size-panel role="listbox" hidden>' +
    items
      .map(
        (item) =>
          '<button type="button" class="size-select__option' + (item.value === currentValue ? " is-selected" : "") +
          '" role="option" data-size-value="' + item.value + '" aria-selected="' + (item.value === currentValue) + '">' +
          item.label + "</button>",
      )
      .join("") +
    "</div></span>"
  );
}

/** 每页条数：预设几档 → 自定义 → 全部（自定义放在全部前面） */
function pageSizeHtml(current: number, sizes: number[] = PAGE_SIZE_OPTIONS, fallback = DEFAULT_SITE_PAGE_SIZE): string {
  return (
    '<span class="admin-pager__size">每页' + sizeSelectHtml(current, sizes) + "条" +
    stepperHtml(
      '<input type="number" min="1" max="' +
        PAGE_SIZE_MAX +
        '" step="1" value="' +
        (current || fallback) +
        '" data-page-size-custom aria-label="自定义每页条数">',
      "每页条数",
      "data-size-stepper hidden",
    ) +
    "</span>"
  );
}

interface PagerConfig {
  id: string;
  total: number;
  page: number;
  pages: number;
  /** 0 = 全部 */
  pageSize: number;
  /** 每页条数下拉里的档位，默认取全局 PAGE_SIZE_OPTIONS */
  sizes?: number[];
  /** 选中「全部」时自定义输入框里回填的默认档位 */
  sizeFallback?: number;
}

/** 书签、标签共用的分页器：左侧统计 + 每页条数，右侧跳页 + 页码 */
function pagerHtml(config: PagerConfig): string {
  const { id, total, page, pages, pageSize, sizes, sizeFallback } = config;
  if (total <= 0) return "";
  const nav = (target: number, label: string, disabled: boolean, title: string): string =>
    '<button type="button" class="admin-pager__btn" data-page="' + target + '" title="' + title + '" aria-label="' + title + '"' + (disabled ? " disabled" : "") + ">" + label + "</button>";
  const numbers = pageNumbers(page, pages)
    .map((item) =>
      item === "gap"
        ? '<span class="admin-pager__gap" aria-hidden="true">…</span>'
        : '<button type="button" class="admin-pager__btn' + (item === page ? " active" : "") + '" data-page="' + item + '"' + (item === page ? ' aria-current="page"' : "") + ">" + item + "</button>",
    )
    .join("");
  const from = pageSize === 0 ? 1 : (page - 1) * pageSize + 1;
  const to = pageSize === 0 ? total : Math.min(page * pageSize, total);
  const summary = "共 " + num(total) + " 条 · " + (pageSize === 0 ? "全部显示" : "第 " + from + "–" + to + " 条");
  return (
    '<div class="admin-pager" id="' + id + '">' +
    '<div class="admin-pager__left"><span class="admin-pager__info">' + summary + "</span>" + pageSizeHtml(pageSize, sizes, sizeFallback) + "</div>" +
    (pages > 1
      ? '<div class="admin-pager__right">' +
        '<span class="admin-pager__jump">跳至' +
        stepperHtml(
          '<input type="number" min="1" max="' + pages + '" step="1" value="' + page + '" data-page-jump aria-label="跳转页码">',
          "跳转页码",
        ) +
        "页<span class=\"admin-pager__jump-total\"> / 共 " + pages + " 页</span></span>" +
        '<div class="admin-pager__nav">' +
        nav(1, "«", page <= 1, "首页") +
        nav(page - 1, "‹", page <= 1, "上一页") +
        numbers +
        nav(page + 1, "›", page >= pages, "下一页") +
        nav(pages, "»", page >= pages, "末页") +
        "</div>" +
        "</div>"
      : "") +
    "</div>"
  );
}

let sizePickerGlobalBound = false;

/** 点面板以外的地方收起「每页条数」；整页只注册一次 */
function bindSizePickerGlobal(): void {
  if (sizePickerGlobalBound) return;
  sizePickerGlobalBound = true;
  document.addEventListener("pointerdown", (event) => {
    const target = event.target as Element | null;
    const inside = target?.closest<HTMLElement>("[data-size-select]") ?? null;
    $$<HTMLElement>("[data-size-panel]").forEach((panel) => {
      if (inside && inside.contains(panel)) return;
      panel.hidden = true;
      panel.closest(".size-select")?.querySelector("[data-size-trigger]")?.setAttribute("aria-expanded", "false");
    });
  });
}

/** 给 region 里的分页器挂事件；每次重绘 region 后都要重新调用 */
function bindPager(region: HTMLElement | null, go: (page: number) => void, onSize: (size: number) => void): void {
  if (!region) return;
  $$<HTMLButtonElement>("[data-page]", region).forEach((el) =>
    el.addEventListener("click", () => go(Number(el.dataset.page))),
  );
  const jump = $<HTMLInputElement>("[data-page-jump]", region);
  if (jump) {
    const submit = () => go(Number(jump.value));
    jump.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      submit();
    });
    jump.addEventListener("change", submit);
  }
  const sizeSelect = $<HTMLElement>("[data-size-select]", region);
  const sizeTrigger = $<HTMLButtonElement>("[data-size-trigger]", region);
  const sizePanel = $<HTMLElement>("[data-size-panel]", region);
  const custom = $<HTMLInputElement>("[data-page-size-custom]", region);
  const sizeStepper = $<HTMLElement>("[data-size-stepper]", region);
  let sizeStepTimer = 0;

  bindSizePickerGlobal();

  const closePanel = () => {
    if (sizePanel) sizePanel.hidden = true;
    sizeTrigger?.setAttribute("aria-expanded", "false");
  };

  sizeTrigger?.addEventListener("click", () => {
    if (!sizePanel) return;
    if (!sizePanel.hidden) {
      closePanel();
      return;
    }
    sizePanel.hidden = false;
    sizeTrigger.setAttribute("aria-expanded", "true");
    // 分页器常在页面底部，下方空间不够就向上弹
    const rect = sizeTrigger.getBoundingClientRect();
    sizeSelect?.classList.toggle("is-up", window.innerHeight - rect.bottom < 220);
    sizePanel.querySelector<HTMLElement>(".is-selected")?.scrollIntoView({ block: "nearest" });
  });

  sizeTrigger?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePanel();
  });

  sizePanel?.addEventListener("click", (event) => {
    const option = (event.target as Element).closest<HTMLElement>("[data-size-value]");
    if (!option) return;
    const value = option.dataset.sizeValue ?? "";
    closePanel();
    if (value === "custom") {
      // 先展开输入框，等用户填完回车/失焦再应用，避免中途用旧值重绘
      if (sizeTrigger) sizeTrigger.textContent = "自定义";
      sizeSelect?.classList.add("is-wide");
      if (custom && sizeStepper) {
        sizeStepper.hidden = false;
        custom.focus();
        custom.select();
      }
      return;
    }
    sizeSelect?.classList.remove("is-wide");
    if (sizeStepper) sizeStepper.hidden = true;
    onSize(normalizePageSize(Number(value)));
  });
  if (custom) {
    const apply = () => onSize(normalizePageSize(Number(custom.value)));
    custom.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        apply();
      }
    });
    custom.addEventListener("change", apply);
  }
  // 常显的 − / + 按钮：跳页立即生效；每页条数连续点击时先累积，停手 400ms 再应用
  $$<HTMLButtonElement>("[data-step]", region).forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = btn.closest(".num-stepper")?.querySelector<HTMLInputElement>("input");
      if (!input) return;
      const min = Number(input.min) || 0;
      const max = Number(input.max) || 0;
      let next = (Number(input.value) || min) + (Number(btn.dataset.step) || 0);
      if (min) next = Math.max(min, next);
      if (max) next = Math.min(max, next);
      input.value = String(next);
      if (input.hasAttribute("data-page-jump")) {
        go(next);
        return;
      }
      if (!custom) return;
      window.clearTimeout(sizeStepTimer);
      sizeStepTimer = window.setTimeout(() => onSize(normalizePageSize(Number(custom.value))), 400);
    });
  });
}

function siteIconUrl(site: AdminSite): string {
  if (site.iconUrl) return site.iconUrl;
  try {
    return "https://t3.gstatic.cn/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=" + encodeURIComponent(new URL(site.url).origin) + "&size=64";
  } catch {
    return "";
  }
}

/** AI 任务超过这个时长还没结束，就认为已中断（部署、进程重启等），不再显示“生成中” */
const AI_PENDING_STALE_MS = 5 * 60 * 1000;

/** 徽章只认“新鲜”的 pending：卡死的任务不能让列表一直转圈 */
function aiPendingVisible(site: AdminSite): boolean {
  if (!site.aiPending) return false;
  const at = parseDbTime(site.updatedAt);
  return !at || Date.now() - at.getTime() < AI_PENDING_STALE_MS;
}

function siteRowHtml(site: AdminSite): string {
  const icon = siteIconUrl(site);
  // AI 简介状态徽章：生成中（黄，脉冲）/ 失败・中断（红，可点重试）/ 已生成（蓝）
  const pending = aiPendingVisible(site);
  const aiBadge = pending
    ? '<span class="ai-badge ai-badge--pending" title="AI 正在后台生成简介">AI 生成中</span>'
    : site.aiError
      ? '<button type="button" class="ai-badge ai-badge--error" data-action="retry-ai" data-id="' + site.id + '" title="' + esc(site.aiError) + '">AI 生成失败 · 重试</button>'
      : site.aiPending
        ? '<button type="button" class="ai-badge ai-badge--error" data-action="retry-ai" data-id="' + site.id + '" title="任务可能已中断，点此重新生成">AI 生成中断 · 重试</button>'
        : site.aiGenerated
          ? '<span class="ai-badge ai-badge--generated" title="简介由 AI 生成">AI 生成</span>'
          : "";
  return (
    "<tr>" +
    '<td><div class="site-cell"><span class="site-avatar"><span class="site-avatar__fallback">' + siteInitial(site) + "</span>" +
    (icon ? '<img src="' + esc(icon) + '" alt="" loading="lazy" referrerpolicy="no-referrer" data-admin-site-icon>' : "") +
    '</span><div class="site-cell__body"><div class="site-cell__name' + (aiBadge ? " site-cell__name--ai" : "") +
    '"><b>' + esc(site.name) + "</b>" + aiBadge +
    "</div><span>" + esc(site.domain) + "</span></div></div></td>" +
    "<td class=\"col-center\">" + esc(site.categoryName) + "</td>" +
    '<td class="tags-col">' + (site.tags.length ? site.tags.map((tag) => '<span class="admin-tag">' + esc(tag) + "</span>").join("") : '<span class="admin-muted">—</span>') + "</td>" +
    '<td class="num-col">' + num(site.views) + "</td>" +
    '<td class="num-col">' + num(site.jumps) + "</td>" +
    '<td class="col-center"><button type="button" class="link-status link-status--' + site.linkStatus + ' link-status--button" data-action="check-site" data-id="' + site.id + '" title="点击重新检测">' + statusText(site.linkStatus) + "</button></td>" +
    '<td class="actions-col"><button type="button" class="admin-text-btn" data-action="edit-site" data-id="' + site.id + '">编辑</button><button type="button" class="admin-text-btn danger" data-action="delete-site" data-id="' + site.id + '">删除</button></td>' +
    "</tr>"
  );
}

function siteTableHtml(rows: AdminSite[]): string {
  return (
    '<table class="admin-table admin-sites-table"><thead><tr><th>站点</th><th class="col-center">分类</th><th class="tags-col">标签</th><th class="num-col">浏览</th><th class="num-col">跳转</th><th class="col-center">状态</th><th class="actions-col">操作</th></tr></thead><tbody id="sites-tbody">' +
    (rows.length ? rows.map(siteRowHtml).join("") : '<tr><td class="admin-empty" colspan="6">没有匹配的书签。</td></tr>') +
    "</tbody></table>"
  );
}

function sitesRegionHtml(): string {
  const paged = sitePageSlice();
  return (
    '<div class="admin-table-wrap">' + siteTableHtml(paged.rows) + "</div>" +
    pagerHtml({ id: "sites-pager", total: paged.total, page: paged.page, pages: paged.pages, pageSize: state.sitePageSize })
  );
}

function renderSites(): string {
  return (
    pageHead(
      "书签",
      state.sites.length + " 个站点，" + (state.sitePageSize === 0 ? "已全部显示" : "每页 " + state.sitePageSize + " 条") + "，按添加顺序固定排列。",
      '<input class="admin-search" id="site-search" type="search" value="' + esc(state.siteQuery) + '" placeholder="搜索书签" aria-label="搜索书签">' +
        siteFilterPickerHtml() +
        button("检测链接", "check-links", "ghost") +
        button("新增书签", "new-site", "primary"),
    ) +
    '<div class="admin-table-region" id="sites-table-region">' + sitesRegionHtml() + "</div>"
  );
}

function renderSitesTable(): void {
  const region = $<HTMLElement>("#sites-table-region");
  if (!region) return;
  region.innerHTML = sitesRegionHtml();
  bindSiteRows();
  bindSiteIcons();
  bindSitesPager();
}

function goSitePage(page: number): void {
  const pages = sitePageCount(siteRows().length);
  const target = Math.min(Math.max(1, Math.round(page) || 1), pages);
  if (Number.isFinite(target) && target === state.sitePage) return;
  state.sitePage = target;
  renderSitesTable();
  const region = $<HTMLElement>("#sites-table-region");
  // 翻页后把表格顶端带回视野，否则要手动往上滚才能看到新的一页
  if (region && region.getBoundingClientRect().top < 0) region.scrollIntoView({ block: "start", behavior: "smooth" });
}

function bindSitesPager(): void {
  const region = $<HTMLElement>("#sites-table-region");
  if (!region) return;
  bindPager(region, goSitePage, (size) => {
    if (size === state.sitePageSize) return;
    state.sitePageSize = size;
    storePageSize(SITE_PAGE_SIZE_KEY, size);
    state.sitePage = 1;
    renderSitesTable();
  });
}

function bindSites(): void {
  const search = $<HTMLInputElement>("#site-search");
  search?.addEventListener("input", () => {
    state.siteQuery = search.value;
    state.sitePage = 1;
    renderSitesTable();
  });
  const category = $<HTMLElement>("#site-category-filter");
  category?.addEventListener("cat-pick", (event) => {
    const id = (event as CustomEvent<string>).detail;
    state.siteCategory = id ? Number(id) : null;
    state.sitePage = 1;
    renderSitesTable();
  });
  bindSiteRows();
  bindSiteIcons();
  bindSitesPager();
  bindCategoryPickers();
}

function bindSiteIcons(): void {
  $$<HTMLImageElement>("img[data-admin-site-icon]").forEach((img) => {
    const remove = () => img.remove();
    img.addEventListener("error", remove, { once: true });
    if (img.complete && img.naturalWidth === 0) remove();
  });
}

function bindSiteRows(): void {
  $$<HTMLElement>('[data-action="edit-site"]').forEach((el) =>
    el.addEventListener("click", () => {
      const site = state.sites.find((item) => item.id === Number(el.dataset.id));
      if (site) openSiteForm(site);
    }),
  );
  $$<HTMLElement>('[data-action="delete-site"]').forEach((el) =>
    el.addEventListener("click", () => removeSite(Number(el.dataset.id))),
  );
  $$<HTMLButtonElement>('[data-action="check-site"]').forEach((el) =>
    el.addEventListener("click", () => checkSite(Number(el.dataset.id), el)),
  );
}

async function checkSite(id: number, button: HTMLButtonElement): Promise<void> {
  const previous = button.textContent ?? "";
  button.disabled = true;
  button.textContent = "检测中…";
  try {
    await api("/api/admin/sites/" + id + "/check", { method: "POST", body: {} });
    toast("链接状态已更新");
    await loadSites();
  } catch (error) {
    button.disabled = false;
    button.textContent = previous;
    toast(error instanceof Error ? error.message : "检测失败", "error");
  }
}

async function reorder(type: "categories" | "pages", ids: number[]): Promise<void> {
  try {
    await api("/api/admin/reorder", { method: "POST", body: { type, ids } });
    await navigate(state.tab, false);
  } catch (error) {
    toast(error instanceof Error ? error.message : "排序保存失败", "error");
    await navigate(state.tab, false);
  }
}

async function removeSite(id: number): Promise<void> {
  if (!window.confirm("确定删除这个书签吗？相关评论也会删除。")) return;
  try {
    await api("/api/admin/sites/" + id, { method: "DELETE" });
    toast("书签已删除");
    await loadSites();
  } catch (error) {
    toast(error instanceof Error ? error.message : "删除失败", "error");
  }
}

interface CategoryPickerItem {
  id: string;
  name: string;
  depth: number;
  icon: string | null;
}

function categoryPickerItems(excludeId?: number, includeNone = false): CategoryPickerItem[] {
  const items: CategoryPickerItem[] = categoryTree()
    .filter(({ category }) => category.id !== excludeId)
    .map(({ category, depth }): CategoryPickerItem => ({ id: String(category.id), name: category.name, depth, icon: category.icon || "folder" }));
  if (includeNone) items.unshift({ id: "", name: "无（顶级分类）", depth: 0, icon: null });
  return items;
}

function pickerIconHtml(icon: string | null, size = 15): string {
  return icon ? categoryIcon(icon, size) : '<span class="cat-select__none-mark">—</span>';
}

function categoryPickerHtml(items: CategoryPickerItem[], selectedId: string | undefined, inputName: string): string {
  const current = items.find((item) => item.id === selectedId) ?? items[0];
  if (!current) {
    // 没有任何分类时退化为禁用占位，提交后由服务端返回错误提示
    return '<input type="hidden" name="' + inputName + '" value=""><button type="button" class="cat-select__trigger" disabled><span class="cat-select__name">暂无分类，请先创建</span></button>';
  }
  const options = items
    .map(
      (item) =>
        '<button type="button" class="cat-select__option' + (item.id === current.id ? " selected" : "") + '" role="option" aria-selected="' + (item.id === current.id ? "true" : "false") + '" data-cat-id="' + item.id + '" data-cat-icon="' + (item.icon ?? "") + '" style="padding-left:' + (9 + item.depth * 14) + 'px">' +
        '<span class="cat-select__opt-icon">' + pickerIconHtml(item.icon) + "</span>" +
        '<span class="cat-select__opt-name">' + esc(item.name) + "</span>" +
        "</button>",
    )
    .join("");
  return (
    '<div class="cat-select" data-cat-select>' +
    '<input type="hidden" name="' + inputName + '" value="' + current.id + '">' +
    '<button type="button" class="cat-select__trigger" data-cat-trigger aria-haspopup="listbox" aria-expanded="false">' +
    '<span class="cat-select__icon">' + pickerIconHtml(current.icon) + "</span>" +
    '<span class="cat-select__name">' + esc(current.name) + "</span>" +
    '<span class="cat-select__caret" aria-hidden="true">▾</span>' +
    "</button>" +
    '<div class="cat-select__panel" data-cat-panel hidden role="listbox">' + options + "</div>" +
    "</div>"
  );
}

function bindCategoryPickers(): void {
  $$<HTMLElement>("[data-cat-select]").forEach((root) => {
    if (root.dataset.catBound) return;
    root.dataset.catBound = "1";
    const hidden = root.querySelector<HTMLInputElement>("input[type=hidden]");
    const trigger = $<HTMLButtonElement>("[data-cat-trigger]", root);
    const panel = $<HTMLElement>("[data-cat-panel]", root);
    if (!hidden || !trigger || !panel) return;

    const setOpen = (open: boolean) => {
      if (!open) {
        panel.hidden = true;
        panel.style.maxHeight = "";
        root.classList.remove("is-up");
        trigger.setAttribute("aria-expanded", "false");
        return;
      }
      // 面板尽量高：按“最近的可滚动父容器”（抽屉主体）剩余空间算，
      // 下方不够就翻到上方，避免被抽屉底边裁掉一截看起来“太矮”
      const rect = trigger.getBoundingClientRect();
      const scroller = root.closest<HTMLElement>(".admin-drawer__body");
      const bound = scroller ? scroller.getBoundingClientRect() : null;
      const gap = 8;
      const spaceBelow = (bound ? bound.bottom : window.innerHeight) - rect.bottom - gap;
      const spaceAbove = rect.top - (bound ? bound.top : 0) - gap;
      const up = spaceBelow < 300 && spaceAbove > spaceBelow;
      const available = up ? spaceAbove : spaceBelow;
      root.classList.toggle("is-up", up);
      panel.style.maxHeight = Math.max(180, Math.min(600, available)) + "px";
      panel.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
    };

    // 用 pointerdown 切换，而不是 click：label 的点击转发只合成 click，
    // 若在 click 收起，label 随后转发给触发按钮会立刻把面板重新弹开
    trigger.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      setOpen(panel.hidden);
    });

    trigger.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setOpen(panel.hidden);
      }
    });

    panel.addEventListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLElement>("[data-cat-id]");
      if (!option) return;
      const id = option.dataset.catId ?? "";
      const category = id ? state.categories.find((item) => item.id === Number(id)) : null;
      if (id && !category) return;
      hidden.value = id;
      $<HTMLElement>(".cat-select__icon", root)!.innerHTML = pickerIconHtml(option.dataset.catIcon || null);
      $<HTMLElement>(".cat-select__name", root)!.textContent = category ? category.name : "无（顶级分类）";
      $$<HTMLElement>("[data-cat-id]", panel).forEach((item) => {
        const active = (item.dataset.catId ?? "") === id;
        item.classList.toggle("selected", active);
        item.setAttribute("aria-selected", String(active));
      });
      setOpen(false);
      root.dispatchEvent(new CustomEvent("cat-pick", { detail: id, bubbles: true }));
    });

    // 面板展开时 Esc 只关闭面板，不冒泡触发关闭整个抽屉
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !panel.hidden) {
        event.stopPropagation();
        setOpen(false);
        trigger.focus();
      }
    });

    document.addEventListener("pointerdown", function onOutsidePointer(event) {
      if (!root.isConnected) {
        document.removeEventListener("pointerdown", onOutsidePointer);
        return;
      }
      if (!root.contains(event.target as Node)) setOpen(false);
    });
  });
}

/** 拉取全站标签聚合，用于“已有标签”与输入联想（比 state.sites 更权威，标签改名后也能立即同步） */
async function fetchKnownTags(): Promise<AdminTag[]> {
  const data = await api<AdminTagsPayload>("/api/admin/tags");
  state.tags = data.tags;
  state.tagsTotalSites = data.totalSites;
  return data.tags;
}

/** 标签统一按名称排序（zh-CN 即拼音序），同名忽略大小写；次数只用于展示，不参与排序 */
function sortTagsByName(tags: AdminTag[]): AdminTag[] {
  return tags.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

/**
 * 抽屉打开那一刻的标签候选：先用本地已加载的书签现算次数，
 * 再用 state.tags（接口聚合结果）覆盖，保证名称和次数与「标签」tab 一致。
 */
function aggregateTagCounts(): AdminTag[] {
  const map = new Map<string, AdminTag>();
  for (const site of state.sites) {
    for (const tag of site.tags) {
      const key = tag.toLowerCase();
      const found = map.get(key);
      if (found) found.count += 1;
      else map.set(key, { name: tag, count: 1 });
    }
  }
  for (const tag of state.tags) {
    map.set(tag.name.toLowerCase(), { name: tag.name, count: tag.count });
  }
  return sortTagsByName([...map.values()]);
}

function openSiteForm(site?: AdminSite): void {
  const editing = Boolean(site);
  const selectedTags = [...new Set(site?.tags ?? [])];
  const selectedKeys = new Set(selectedTags.map((tag) => tag.toLowerCase()));
  const knownTags = aggregateTagCounts().filter((tag) => !selectedKeys.has(tag.name.toLowerCase()));
  openDrawer(
    editing ? "编辑书签" : "新增书签",
    '<form class="admin-form" data-form="site" data-id="' + (site?.id ?? "") + '">' +
      '<div class="form-grid">' +
      field("站点名称", '<input name="name" required maxlength="80" value="' + esc(site?.name ?? "") + '">') +
      field("网址", '<input name="url" type="url" required value="' + esc(site?.url ?? "") + '">') +
      field("分类", categoryPickerHtml(categoryPickerItems(), site?.categoryId != null ? String(site.categoryId) : undefined, "categoryId")) +
      "</div>" +
      '<div class="form-field full"><span>标签</span><div class="tag-editor" data-tag-editor>' +
      '<div class="tag-chips" data-tag-chips></div>' +
      '<div class="tag-input-row"><div class="tag-input-wrap"><input id="site-tag-input" autocomplete="off" maxlength="24" placeholder="输入新标签后回车，或点击下方已有标签" role="combobox" aria-expanded="false" aria-autocomplete="list"><div class="tag-suggest-panel" data-tag-panel hidden></div></div><button type="button" class="admin-button admin-button--ghost" data-action="add-site-tag">添加</button><span class="tag-limit" data-tag-limit></span></div>' +
      '<div class="tag-suggestions" data-tag-suggestions></div>' +
      '<input type="hidden" name="tags" value="' + esc(selectedTags.join(", ")) + '">' +
      "</div></div>" +
      field("简介", '<textarea name="description" rows="4" maxlength="1200" placeholder="留空保存时自动生成">' + esc(site?.description ?? "") + "</textarea>", "full") +
      '<div class="form-field full"><div class="md-field-head"><span>详情介绍</span><button type="button" class="admin-text-btn" data-action="preview-detail">预览 Markdown</button></div>' +
      '<textarea name="detailContent" rows="10" data-detail-content>' + esc(site?.detailContent ?? "") + "</textarea>" +
      '<div class="md-preview" data-detail-preview hidden></div></div>' +
      '<div class="form-grid">' + field("图标地址（选填）", '<input name="iconUrl" value="' + esc(site?.iconUrl ?? "") + '">') + field("截图地址（选填）", '<input name="screenshotUrl" value="' + esc(site?.screenshotUrl ?? "") + '">') + "</div>" +
      '<div class="drawer-actions">' + (editing ? '<button type="button" class="admin-button admin-button--ghost" data-action="ai-site" data-id="' + site!.id + '">AI 重写简介</button>' : "") + '<button type="submit" class="admin-button admin-button--primary">保存书签</button></div>' +
      "</form>",
  );
  const tagEditor = bindSiteTagEditor(selectedTags, knownTags);
  bindCategoryPickers();
  bindDetailPreview();
  // 标签可能刚在“标签”tab 改过名，异步用聚合接口校正一次，不阻塞抽屉打开
  void fetchKnownTags()
    .then((tags) => tagEditor.setKnown(tags))
    .catch(() => undefined);
}

/** 标签上限，与服务端 worker/utils.ts 的 parseTags() 保持一致，否则超出部分会被静默丢弃 */
const SITE_TAG_LIMIT = 8;
/** “已有标签”默认展开的条数，超出时给“展开全部”，避免表单被撑得太长又不丢标签 */
const SUGGEST_PREVIEW = 16;

interface SiteTagEditorApi {
  /** 用服务端聚合结果（含使用次数）校正“已有标签”列表 */
  setKnown: (tags: AdminTag[]) => void;
}

function bindSiteTagEditor(selected: string[], known: AdminTag[]): SiteTagEditorApi {
  const editor = $<HTMLElement>("[data-tag-editor]");
  if (!editor) return { setKnown: () => undefined };
  const values = [...selected];
  let knownTags = sortTagsByName([...known]);
  const chips = $<HTMLElement>("[data-tag-chips]", editor)!;
  const suggestions = $<HTMLElement>("[data-tag-suggestions]", editor)!;
  const input = $<HTMLInputElement>("#site-tag-input", editor)!;
  const panel = $<HTMLElement>("[data-tag-panel]", editor)!;
  const hidden = $<HTMLInputElement>('input[name="tags"]', editor)!;
  const limitEl = $<HTMLElement>("[data-tag-limit]", editor)!;
  const defaultPlaceholder = input.placeholder;
  let warnTimer = 0;
  let blurTimer = 0;
  let matches: AdminTag[] = [];
  let activeIndex = -1;
  let suggestExpanded = false;

  const hasTag = (tag: string) => values.some((item) => item.toLowerCase() === tag.toLowerCase());
  const isFull = () => values.length >= SITE_TAG_LIMIT;

  const closePanel = () => {
    panel.hidden = true;
    panel.innerHTML = "";
    matches = [];
    activeIndex = -1;
    input.setAttribute("aria-expanded", "false");
  };

  const paintPanel = () => {
    if (!matches.length) {
      closePanel();
      return;
    }
    panel.innerHTML = matches
      .map(
        (item, index) =>
          '<button type="button" class="tag-suggest-option' +
          (index === activeIndex ? " is-active" : "") +
          '" data-action="suggest-site-tag" data-tag="' +
          esc(item.name) +
          '" role="option" aria-selected="' +
          (index === activeIndex) +
          '">' +
          esc(item.name) +
          '<span class="tag-suggest-num">(' + item.count + ")</span></button>",
      )
      .join("");
    panel.hidden = false;
    input.setAttribute("aria-expanded", "true");
    panel.querySelector<HTMLElement>(".is-active")?.scrollIntoView({ block: "nearest" });
  };

  /** 边输入边匹配已有标签，输入为空时收起（此时用下方“已有标签”整块） */
  const refreshMatches = () => {
    const query = input.value.replace(/[#\r\n\t]/g, " ").trim().toLowerCase();
    activeIndex = -1;
    if (!query || isFull()) {
      closePanel();
      return;
    }
    matches = knownTags
      .filter((item) => !hasTag(item.name) && item.name.toLowerCase().includes(query))
      .slice(0, 50);
    if (!matches.length) {
      panel.innerHTML = '<div class="tag-suggest-hint">没有匹配的标签，回车可直接新建「' + esc(query) + "」</div>";
      panel.hidden = false;
      input.setAttribute("aria-expanded", "true");
      return;
    }
    paintPanel();
  };

  const render = () => {
    chips.innerHTML = values.length
      ? values.map((tag) => '<span class="tag-chip">' + esc(tag) + '<button type="button" data-action="remove-site-tag" data-tag="' + esc(tag) + '" aria-label="删除标签">×</button></span>').join("")
      : '<span class="tag-empty">还没有标签</span>';
    const remaining = knownTags.filter((item) => !hasTag(item.name));
    const full = isFull();
    // 默认全部铺开；数量特别多时先显示一屏并给“展开全部”，点开就是全量，绝不静默丢掉
    const shown = suggestExpanded ? remaining : remaining.slice(0, SUGGEST_PREVIEW);
    suggestions.innerHTML = remaining.length
      ? '<div class="tag-suggest-head"><span class="tag-suggest-label">已有标签</span><span class="tag-suggest-count">剩余 ' + remaining.length + " 个 · 全站 " + (remaining.length + values.length) + " 个</span>" +
        (remaining.length > SUGGEST_PREVIEW
          ? '<button type="button" class="tag-suggest-more" data-action="toggle-suggest">' + (suggestExpanded ? "收起" : "展开全部 (" + remaining.length + ")") + "</button>"
          : "") +
        "</div>" +
        shown.map((item) => '<button type="button" class="tag-suggest" data-action="suggest-site-tag" data-tag="' + esc(item.name) + '"' + (full ? " disabled" : "") + ">" + esc(item.name) + '<span class="tag-suggest-num">(' + item.count + ")</span></button>").join("")
      : '<span class="tag-suggest-hint">还没有其他标签，直接输入新标签即可</span>';
    hidden.value = values.join(", ");
    input.placeholder = full ? "已达上限，删除标签后可继续添加" : defaultPlaceholder;
    if (warnTimer) window.clearTimeout(warnTimer);
    warnTimer = 0;
    limitEl.classList.remove("is-full");
    limitEl.textContent = values.length + " / " + SITE_TAG_LIMIT;
    if (full) {
      limitEl.classList.add("is-full");
      limitEl.textContent = "已达上限 " + values.length + " / " + SITE_TAG_LIMIT;
    }
    refreshMatches();
  };

  const warnLimit = () => {
    if (warnTimer) window.clearTimeout(warnTimer);
    limitEl.classList.add("is-full");
    limitEl.textContent = "最多 " + SITE_TAG_LIMIT + " 个标签，请先删除一个";
    warnTimer = window.setTimeout(render, 1800);
  };

  const add = (raw: string) => {
    const tag = raw.trim().slice(0, 24);
    if (!tag) return;
    if (hasTag(tag)) {
      input.value = "";
      refreshMatches();
      return;
    }
    if (isFull()) {
      warnLimit();
      return;
    }
    values.push(tag);
    input.value = "";
    render();
    input.focus();
  };

  editor.addEventListener("click", (event) => {
    const target = (event.target as Element).closest<HTMLElement>("[data-action]");
    if (!target) return;
    if (target.dataset.action === "add-site-tag") add(input.value);
    else if (target.dataset.action === "suggest-site-tag") add(target.dataset.tag ?? "");
    else if (target.dataset.action === "toggle-suggest") {
      suggestExpanded = !suggestExpanded;
      render();
    } else if (target.dataset.action === "remove-site-tag") {
      const index = values.indexOf(target.dataset.tag ?? "");
      if (index >= 0) values.splice(index, 1);
      render();
    }
  });

  // 点下拉项时不让输入框失焦，否则 mousedown 就先触发 blur 把面板收掉了
  panel.addEventListener("mousedown", (event) => {
    event.preventDefault();
    if (blurTimer) window.clearTimeout(blurTimer);
  });

  input.addEventListener("input", refreshMatches);
  input.addEventListener("focus", refreshMatches);
  input.addEventListener("blur", () => {
    if (blurTimer) window.clearTimeout(blurTimer);
    blurTimer = window.setTimeout(closePanel, 120);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (panel.hidden || !matches.length) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      activeIndex = (activeIndex + step + matches.length) % matches.length;
      paintPanel();
      return;
    }
    if (event.key === "Escape") {
      // 只收起下拉，不触发关闭整个抽屉
      if (!panel.hidden) {
        event.stopPropagation();
        closePanel();
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      // 有高亮项就选高亮项，否则把输入内容作为新标签
      if (!panel.hidden && activeIndex >= 0 && matches[activeIndex]) add(matches[activeIndex].name);
      else add(input.value);
    }
  });

  render();
  return {
    setKnown: (tags) => {
      if (!editor.isConnected) return;
      knownTags = sortTagsByName([...tags]);
      render();
    },
  };
}

function bindMarkdownPreview(action: string, textareaSelector: string, previewSelector: string): void {
  const button = $<HTMLButtonElement>('[data-action="' + action + '"]');
  const textarea = $<HTMLTextAreaElement>(textareaSelector);
  const preview = $<HTMLElement>(previewSelector);
  if (!button || !textarea || !preview) return;
  button.addEventListener("click", () => {
    if (preview.hidden) {
      preview.innerHTML = renderMarkdown(textarea.value) || '<p class="admin-muted">暂无内容</p>';
      preview.hidden = false;
      textarea.hidden = true;
      button.textContent = "返回编辑";
    } else {
      preview.hidden = true;
      textarea.hidden = false;
      button.textContent = "预览 Markdown";
    }
  });
}

function bindDetailPreview(): void {
  bindMarkdownPreview("preview-detail", "[data-detail-content]", "[data-detail-preview]");
}

/* ---------- categories ---------- */

async function loadCategoryData(): Promise<void> {
  const data = await api<{ categories: AdminCategory[] }>("/api/admin/categories");
  state.categories = data.categories;
}

async function loadCategories(): Promise<void> {
  await loadCategoryData();
  frame(renderCategories());
  bindCategoryActions();
}

function categoryTree(): Array<{ category: AdminCategory; depth: number }> {
  const out: Array<{ category: AdminCategory; depth: number }> = [];
  const walk = (parent: number | null, depth: number) => {
    state.categories
      .filter((category) => category.parentId === parent)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
      .forEach((category) => {
        out.push({ category, depth });
        walk(category.id, depth + 1);
      });
  };
  walk(null, 0);
  return out;
}

function renderCategories(): string {
  const rows = categoryTree();
  return (
    pageHead("分类", "拖拽同级分类调整顺序。", button("新增分类", "new-category", "primary")) +
    '<div class="admin-list">' +
    (rows.length
      ? rows
          .map(
            ({ category, depth }) =>
              '<div class="category-row" data-drag-id="' + category.id + '" data-parent="' + (category.parentId ?? "root") + '" data-depth="' + depth + '" draggable="true" style="padding-left:' + (10 + depth * 22) + 'px">' +
              '<span class="drag-handle">⠿</span><span class="category-icon">' + categoryIcon(category.icon || "folder", 15) + "</span>" +
              '<div class="category-main"><b>' + esc(category.name) + "</b><span>/" + esc(category.slug) + " · " + category.directSiteCount + " 个书签</span></div>" +
              '<div class="row-actions"><button type="button" class="admin-text-btn" data-action="edit-category" data-id="' + category.id + '">编辑</button><button type="button" class="admin-text-btn danger" data-action="delete-category" data-id="' + category.id + '">删除</button></div></div>',
          )
          .join("")
      : '<div class="admin-empty">还没有分类。</div>') +
    "</div>"
  );
}

function bindCategoryActions(): void {
  $$<HTMLElement>('[data-action="edit-category"]').forEach((el) =>
    el.addEventListener("click", () => {
      const category = state.categories.find((item) => item.id === Number(el.dataset.id));
      if (category) openCategoryForm(category);
    }),
  );
  $$<HTMLElement>('[data-action="delete-category"]').forEach((el) => el.addEventListener("click", () => removeCategory(Number(el.dataset.id))));
  enableCategoryDrag();
}

function openCategoryForm(category?: AdminCategory): void {
  openDrawer(
    category ? "编辑分类" : "新增分类",
    '<form class="admin-form" data-form="category" data-id="' + (category?.id ?? "") + '">' +
      '<div class="form-grid">' +
      field("分类名称", '<input name="name" required maxlength="40" value="' + esc(category?.name ?? "") + '">') +
      field("上级分类", categoryPickerHtml(categoryPickerItems(category?.id, true), category?.parentId != null ? String(category.parentId) : "", "parentId")) +
      field("分类路径（选填）", '<input name="slug" value="' + esc(category?.slug ?? "") + '">') +
      "</div>" +
      '<div class="form-field full"><span>图标</span><input type="hidden" name="icon" value="' + esc(category?.icon ?? "folder") + '"><button type="button" class="icon-trigger" data-icon-trigger>' +
      '<span class="icon-trigger__preview">' + categoryIcon(category?.icon ?? "folder", 22) + "</span>" +
      '<span class="icon-trigger__name" data-icon-name>' + esc(category?.icon ?? "folder") + "</span>" +
      '<span class="icon-trigger__hint">选择图标</span></button></div>' +
      field("分类描述", '<textarea name="description" rows="3" maxlength="300">' + esc(category?.description ?? "") + "</textarea>", "full") +
      '<div class="drawer-actions"><button type="submit" class="admin-button admin-button--primary">保存分类</button></div></form>',
  );
  bindIconPicker();
  bindCategoryPickers();
}

function bindIconPicker(): void {
  const trigger = $<HTMLButtonElement>("[data-icon-trigger]");
  if (!trigger) return;
  trigger.addEventListener("click", () => openIconModal(trigger));
}

/* ---------- 图标选择弹窗：精选分组 + 全库搜索 + 自定义名称 ---------- */

const CURATED_ICON_NAMES = [...new Set(CATEGORY_ICON_GROUPS.flatMap((group) => group.icons))];
const CURATED_ICON_SET = new Set(CURATED_ICON_NAMES);
const ICON_SEARCH_LIMIT = 140;
let allIconNames: string[] | null = null;
let allIconLoading: Promise<string[]> | null = null;

/** 全量图标名列表（35KB）只在需要时拉一次，失败保持 null 以便下次重试 */
function loadAllIconNames(): Promise<string[]> {
  if (allIconNames) return Promise.resolve(allIconNames);
  if (!allIconLoading) {
    allIconLoading = fetch("/lucide-names.json")
      .then((res) => (res.ok ? (res.json() as Promise<unknown>) : []))
      .then((list) => {
        allIconNames = Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
        return allIconNames;
      })
      .catch(() => {
        allIconLoading = null;
        return [];
      });
  }
  return allIconLoading;
}

function iconChoiceHtml(icon: string, current: string): string {
  return (
    '<button type="button" class="icon-choice' + (icon === current ? " selected" : "") + '" data-pick-icon="' + icon +
    '" title="' + icon + '" aria-label="' + icon + '">' + categoryIcon(icon, 20) + "</button>"
  );
}

function iconGridHtml(names: string[], current: string): string {
  return names.map((icon) => iconChoiceHtml(icon, current)).join("");
}

function iconGroupHtml(label: string, names: string[], current: string): string {
  return (
    '<div class="icon-group"><div class="icon-group__head"><span class="icon-group__label">' + esc(label) +
    '</span><span class="icon-group__num">' + names.length + "</span></div>" +
    '<div class="icon-group__grid">' + iconGridHtml(names, current) + "</div></div>"
  );
}

function renderIconResults(box: HTMLElement, input: HTMLInputElement, count: HTMLElement, current: string): void {
  const query = input.value.trim().toLowerCase();
  if (!query) {
    box.innerHTML = CATEGORY_ICON_GROUPS.map((group) => iconGroupHtml(group.label, group.icons, current)).join("");
    count.textContent = "精选 " + CURATED_ICON_NAMES.length + " 个";
    return;
  }

  const hits = CURATED_ICON_NAMES.filter((icon) => icon.includes(query));
  const extra = allIconNames
    ? allIconNames.filter((icon) => icon.includes(query) && !CURATED_ICON_SET.has(icon)).slice(0, ICON_SEARCH_LIMIT)
    : [];

  let html = "";
  if (hits.length) html += iconGroupHtml("精选匹配", hits, current);
  if (extra.length) html += iconGroupHtml("Lucide 全库", extra, current);
  if (allIconNames && !hits.length && !extra.length) {
    html = '<p class="icon-empty">没有找到“' + esc(input.value.trim()) + '”，换英文关键词试试，或到 lucide.dev 查名称。</p>';
  }
  if (!allIconNames) {
    html += '<p class="icon-empty">正在加载 Lucide 全库（2300+）…</p>';
    const asked = query;
    void loadAllIconNames().then(() => {
      if (box.isConnected && input.value.trim().toLowerCase() === asked) {
        renderIconResults(box, input, count, current);
      }
    });
  }
  box.innerHTML = html;
  count.textContent = "命中 " + (hits.length + extra.length) + " 个";
}

function openIconModal(trigger: HTMLButtonElement): void {
  const field = trigger.closest(".form-field");
  const hidden = field?.querySelector<HTMLInputElement>('input[name="icon"]');
  const name = field?.querySelector<HTMLElement>("[data-icon-name]");
  const preview = field?.querySelector<HTMLElement>(".icon-trigger__preview");
  if (!hidden) return;
  const current = hidden.value || "folder";
  const modal = document.createElement("div");
  modal.className = "admin-icon-modal";
  modal.innerHTML =
    '<button type="button" class="admin-icon-modal__scrim" data-close-icon-modal aria-label="关闭"></button>' +
    '<section class="admin-icon-modal__panel" role="dialog" aria-modal="true" aria-label="选择分类图标">' +
    '<header class="admin-icon-modal__head"><h2>选择分类图标</h2><button type="button" class="admin-icon-btn" data-close-icon-modal aria-label="关闭">×</button></header>' +
    '<div class="icon-search"><input type="search" data-icon-search placeholder="搜索图标名，如 code、font、rocket" autocomplete="off" spellcheck="false">' +
    '<span class="icon-search__count" data-icon-count></span></div>' +
    '<div class="admin-icon-modal__body" data-icon-results></div>' +
    '<footer class="icon-custom"><span class="icon-custom__label">自定义</span>' +
    '<input type="text" data-icon-custom placeholder="Lucide 名称，如 sailboat" maxlength="40" autocomplete="off" spellcheck="false">' +
    '<button type="button" class="admin-button admin-button--primary icon-custom__apply" data-icon-apply>使用</button>' +
    '<a class="icon-custom__hint" href="https://lucide.dev/icons" target="_blank" rel="noopener noreferrer">查图标名</a></footer>' +
    "</section>";
  document.body.append(modal);

  const box = $<HTMLElement>("[data-icon-results]", modal)!;
  const search = $<HTMLInputElement>("[data-icon-search]", modal)!;
  const count = $<HTMLElement>("[data-icon-count]", modal)!;
  const custom = $<HTMLInputElement>("[data-icon-custom]", modal)!;

  const close = () => modal.remove();

  const choose = (icon: string) => {
    hidden.value = icon;
    if (name) name.textContent = icon;
    if (preview) preview.innerHTML = categoryIcon(icon, 22);
    close();
  };

  renderIconResults(box, search, count, current);
  void loadAllIconNames();

  $$<HTMLElement>("[data-close-icon-modal]", modal).forEach((el) => el.addEventListener("click", close));
  modal.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
  modal.addEventListener("click", (event) => {
    const choice = (event.target as Element).closest<HTMLElement>("[data-pick-icon]");
    if (choice) choose(choice.dataset.pickIcon ?? "folder");
  });
  search.addEventListener("input", () => renderIconResults(box, search, count, current));
  search.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const first = $<HTMLElement>("[data-pick-icon]", box);
    if (first) choose(first.dataset.pickIcon ?? "folder");
  });

  const applyCustom = async () => {
    const value = custom.value.trim().toLowerCase();
    if (!value) {
      toast("请输入图标名", "error");
      custom.focus();
      return;
    }
    if (!isIconName(value)) {
      toast("只能用小写字母、数字和短横线", "error");
      return;
    }
    const list = await loadAllIconNames();
    if (list.length && !list.includes(value)) {
      toast("Lucide 里没有“" + value + "”这个图标", "error");
      return;
    }
    choose(value);
  };
  $<HTMLButtonElement>("[data-icon-apply]", modal)!.addEventListener("click", () => void applyCustom());
  custom.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void applyCustom();
    }
  });

  window.requestAnimationFrame(() => search.focus());
}


async function removeCategory(id: number): Promise<void> {
  if (!window.confirm("确定删除这个分类吗？")) return;
  try {
    await api("/api/admin/categories/" + id, { method: "DELETE" });
    toast("分类已删除");
    await loadCategories();
  } catch (error) {
    toast(error instanceof Error ? error.message : "删除失败", "error");
  }
}

function enableCategoryDrag(): void {
  const list = $<HTMLElement>(".admin-list");
  if (!list) return;
  let dragged: HTMLElement | null = null;
  $$<HTMLElement>(".category-row", list).forEach((row) => {
    row.addEventListener("dragstart", (event) => {
      dragged = row;
      row.classList.add("dragging");
      event.dataTransfer?.setData("text/plain", row.dataset.dragId ?? "");
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => {
      dragged = null;
      $$(".dragging, .drag-over", list).forEach((el) => el.classList.remove("dragging", "drag-over"));
    });
    row.addEventListener("dragover", (event) => {
      if (!dragged || dragged === row) return;
      if (dragged.dataset.parent !== row.dataset.parent) return;
      event.preventDefault();
      row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      if (!dragged || dragged === row || dragged.dataset.parent !== row.dataset.parent) {
        toast("只能在同级分类内拖拽排序", "error");
        return;
      }
      row.classList.remove("drag-over");
      const parent = dragged.dataset.parent;
      const all = $$<HTMLElement>(".category-row", list);
      const from = all.indexOf(dragged);
      const depth = Number(dragged.dataset.depth ?? 0);
      let end = from + 1;
      while (end < all.length && Number(all[end].dataset.depth ?? 0) > depth) end += 1;
      const moving = all.slice(from, end);
      if (moving.includes(row)) {
        toast("不能把分类拖到自己的子分类里", "error");
        return;
      }
      for (const item of moving) list.insertBefore(item, row);
      const ids = $$<HTMLElement>('.category-row[data-parent="' + parent + '"]', list).map((item) =>
        Number(item.dataset.dragId),
      );
      void reorder("categories", ids);
    });
  });
}

/* ---------- tags ---------- */

async function loadTags(): Promise<void> {
  const data = await api<AdminTagsPayload>("/api/admin/tags");
  state.tags = data.tags;
  state.tagsTotalSites = data.totalSites;
  state.tagEditing = null;
  // 清掉已经不存在或改名后的选中项
  state.tagSelected = new Set([...state.tagSelected].filter((name) => state.tags.some((tag) => tag.name === name)));
  frame(renderTags());
  bindTagActions();
}

function filteredTags(): AdminTag[] {
  const query = state.tagQuery.trim().toLowerCase();
  const list = query ? state.tags.filter((tag) => tag.name.toLowerCase().includes(query)) : state.tags;
  const dir = state.tagSortDir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    if (state.tagSort === "name") {
      return a.name.localeCompare(b.name, "zh-CN") * dir || b.count - a.count;
    }
    return (a.count - b.count) * dir || a.name.localeCompare(b.name, "zh-CN");
  });
}

function tagSortHeaderHtml(key: "name" | "count", label: string, className = ""): string {
  const active = state.tagSort === key;
  const mark = active ? (state.tagSortDir === "asc" ? " ↑" : " ↓") : "";
  const cls = className ? ' class="' + className + '"' : "";
  return (
    "<th" +
    cls +
    '><button type="button" class="tag-sort' +
    (active ? " active" : "") +
    '" data-tag-sort="' +
    key +
    '" title="按' +
    label +
    '排序">' +
    label +
    '<span class="tag-sort__mark">' +
    mark +
    "</span></button></th>"
  );
}

function tagRowHtml(tag: AdminTag): string {
  if (state.tagEditing === tag.name) {
    return (
      '<tr class="tag-row--editing">' +
      '<td class="check-col"></td>' +
      '<td colspan="2"><input class="tag-rename-input" data-tag-rename="' + esc(tag.name) + '" value="' + esc(tag.name) + '" maxlength="24" aria-label="新的标签名"></td>' +
      '<td class="actions-col"><button type="button" class="admin-text-btn" data-tag-action="save-rename">保存</button><button type="button" class="admin-text-btn" data-tag-action="cancel-rename">取消</button></td>' +
      "</tr>"
    );
  }
  return (
    '<tr data-tag-row="' + esc(tag.name) + '">' +
    '<td class="check-col"><input type="checkbox" data-tag-check="' + esc(tag.name) + '"' + (state.tagSelected.has(tag.name) ? " checked" : "") + ' aria-label="选择标签 ' + esc(tag.name) + '"></td>' +
    '<td><span class="admin-tag">' + esc(tag.name) + "</span></td>" +
    '<td class="num-col">' + num(tag.count) + "</td>" +
    '<td class="actions-col"><button type="button" class="admin-text-btn" data-tag-action="rename" data-name="' + esc(tag.name) + '">重命名</button><button type="button" class="admin-text-btn danger" data-tag-action="delete" data-name="' + esc(tag.name) + '">删除</button></td>' +
    "</tr>"
  );
}

/** 按当前搜索/排序结果切片；每页条数为 0 时返回全部 */
function tagPageSlice(): { rows: AdminTag[]; total: number; page: number; pages: number } {
  const all = filteredTags();
  const size = state.tagPageSize;
  const pages = pageCount(all.length, size);
  const page = Math.min(Math.max(1, state.tagPage), pages);
  state.tagPage = page;
  if (size === 0) return { rows: all, total: all.length, page: 1, pages: 1 };
  const start = (page - 1) * size;
  return { rows: all.slice(start, start + size), total: all.length, page, pages };
}

function tagTableHtml(): string {
  const paged = tagPageSlice();
  if (!paged.total) {
    return '<div class="admin-empty">' + (state.tags.length ? "没有匹配的标签。" : "还没有标签，先去书签里添加吧。") + "</div>";
  }
  return (
    '<div class="admin-table-wrap"><table class="admin-table admin-tags-table"><thead><tr>' +
    '<th class="check-col"><input type="checkbox" data-tag-check-all aria-label="全选本页标签"></th>' +
    tagSortHeaderHtml("name", "标签") +
    tagSortHeaderHtml("count", "书签数", "num-col") +
    '<th class="actions-col">操作</th></tr></thead><tbody>' +
    paged.rows.map(tagRowHtml).join("") +
    "</tbody></table></div>" +
    pagerHtml({ id: "tags-pager", total: paged.total, page: paged.page, pages: paged.pages, pageSize: state.tagPageSize })
  );
}

function renderTags(): string {
  return (
    pageHead(
      "标签",
      state.tags.length + " 个标签，覆盖 " + state.tagsTotalSites + " 个书签。重命名会同步写入所有书签。",
      '<input class="admin-search" id="tag-search" type="search" value="' + esc(state.tagQuery) + '" placeholder="搜索标签" aria-label="搜索标签">' +
        '<button type="button" class="admin-button admin-button--ghost" data-tag-action="bulk-rename" disabled>批量重命名</button>' +
        '<button type="button" class="admin-button admin-button--ghost" data-tag-action="delete-selected" disabled>删除选中</button>',
    ) +
    '<div class="admin-table-region" id="tags-region">' + tagTableHtml() + "</div>"
  );
}

function renderTagsRegion(): void {
  const region = $<HTMLElement>("#tags-region");
  if (!region) return;
  region.innerHTML = tagTableHtml();
  bindTagPager(region);
  syncTagSelection();
  const input = $<HTMLInputElement>("[data-tag-rename]", region);
  if (input) {
    input.focus();
    input.select();
  }
}

function goTagPage(page: number): void {
  const pages = pageCount(filteredTags().length, state.tagPageSize);
  const target = Math.min(Math.max(1, Math.round(page) || 1), pages);
  if (target === state.tagPage) return;
  state.tagPage = target;
  renderTagsRegion();
}

function bindTagPager(region: HTMLElement): void {
  bindPager(region, goTagPage, (size) => {
    if (size === state.tagPageSize) return;
    state.tagPageSize = size;
    storePageSize(TAG_PAGE_SIZE_KEY, size);
    state.tagPage = 1;
    renderTagsRegion();
  });
}

/** 同步批量删除按钮与表头全选框，不整体重绘，避免打断行内输入 */
function syncTagSelection(): void {
  const deleteButton = $<HTMLButtonElement>('[data-tag-action="delete-selected"]');
  if (deleteButton) {
    const count = state.tagSelected.size;
    deleteButton.textContent = count ? "删除选中(" + count + ")" : "删除选中";
    deleteButton.disabled = count === 0;
  }
  const bulkButton = $<HTMLButtonElement>('[data-tag-action="bulk-rename"]');
  if (bulkButton) {
    const count = state.tagSelected.size;
    bulkButton.textContent = count ? "批量重命名(" + count + ")" : "批量重命名";
    bulkButton.disabled = count === 0;
  }
  const all = $<HTMLInputElement>("[data-tag-check-all]");
  if (!all) return;
  // 只反映本页的勾选情况：分页后“全选”按钮作用于当前页
  const rows = tagPageSlice().rows;
  const picked = rows.filter((tag) => state.tagSelected.has(tag.name)).length;
  all.checked = rows.length > 0 && picked === rows.length;
  all.indeterminate = picked > 0 && picked < rows.length;
}

function bindTagActions(): void {
  const search = $<HTMLInputElement>("#tag-search");
  search?.addEventListener("input", () => {
    state.tagQuery = search.value;
    state.tagPage = 1;
    renderTagsRegion();
  });
  const region = $<HTMLElement>("#tags-region");
  region?.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLElement>("[data-tag-sort]");
    if (!button) return;
    const key = button.dataset.tagSort === "name" ? "name" : "count";
    if (state.tagSort === key) {
      state.tagSortDir = state.tagSortDir === "asc" ? "desc" : "asc";
    } else {
      state.tagSort = key;
      state.tagSortDir = key === "count" ? "desc" : "asc";
    }
    state.tagPage = 1;
    renderTagsRegion();
  });
  region?.addEventListener("change", (event) => {
    const all = (event.target as Element).closest<HTMLInputElement>("[data-tag-check-all]");
    if (all) {
      for (const tag of tagPageSlice().rows) {
        if (all.checked) state.tagSelected.add(tag.name);
        else state.tagSelected.delete(tag.name);
      }
      renderTagsRegion();
      return;
    }
    const one = (event.target as Element).closest<HTMLInputElement>("[data-tag-check]");
    if (!one) return;
    const name = one.dataset.tagCheck ?? "";
    if (one.checked) state.tagSelected.add(name);
    else state.tagSelected.delete(name);
    syncTagSelection();
  });
  region?.addEventListener("keydown", (event) => {
    const input = (event.target as Element).closest<HTMLInputElement>("[data-tag-rename]");
    if (!input) return;
    if (event.key === "Enter") {
      event.preventDefault();
      void saveTagRename(input);
    } else if (event.key === "Escape") {
      event.stopPropagation();
      state.tagEditing = null;
      renderTagsRegion();
    }
  });
  renderTagsRegion();
}

function handleTagAction(action: string, el: HTMLElement): void {
  if (action === "rename") {
    state.tagEditing = el.dataset.name ?? null;
    renderTagsRegion();
  } else if (action === "cancel-rename") {
    state.tagEditing = null;
    renderTagsRegion();
  } else if (action === "save-rename") {
    const input = $<HTMLInputElement>("[data-tag-rename]");
    if (input) void saveTagRename(input);
  } else if (action === "delete") {
    void removeTags([el.dataset.name ?? ""]);
  } else if (action === "delete-selected") {
    void removeTags([...state.tagSelected]);
  } else if (action === "bulk-rename") {
    void bulkRenameTags();
  }
}

async function saveTagRename(input: HTMLInputElement): Promise<void> {
  const from = input.dataset.tagRename ?? "";
  const to = input.value.replace(/[#\r\n\t]/g, " ").trim().slice(0, 24);
  if (!to) {
    toast("标签名不能为空", "error");
    input.focus();
    return;
  }
  if (to === from) {
    state.tagEditing = null;
    renderTagsRegion();
    return;
  }
  // 撞名：提示「合并 / 取消」，合并等于把源标签整体并入已有标签
  const target = state.tags.find((tag) => tag.name.toLowerCase() === to.toLowerCase() && tag.name !== from);
  if (target) {
    const merge = await confirmTagMerge("「" + from + "」", target);
    if (!merge) {
      input.focus();
      return;
    }
    await renameTag(from, target.name, true);
    return;
  }
  await renameTag(from, to, false);
}

function confirmTagMerge(sourceText: string, target: AdminTag): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "admin-icon-modal";
    modal.innerHTML =
      '<button type="button" class="admin-icon-modal__scrim" data-merge="cancel" aria-label="取消"></button>' +
      '<section class="admin-icon-modal__panel admin-merge-panel" role="dialog" aria-modal="true" aria-label="标签重名">' +
      '<header class="admin-icon-modal__head"><h2>标签已存在</h2><button type="button" class="admin-icon-btn" data-merge="cancel" aria-label="取消">×</button></header>' +
      '<div class="admin-icon-modal__body">' +
      '<p class="admin-merge-text">已经有一个叫「' + esc(target.name) + "」的标签，用在 " + num(target.count) + " 个书签上。</p>" +
      '<p class="admin-merge-text">选择合并：' + esc(sourceText) + "会从所有书签里替换成「" + esc(target.name) + "」，书签不会丢失；选择取消：保留原来的标签名。</p>" +
      '<div class="admin-merge-actions"><button type="button" class="admin-button admin-button--primary" data-merge="ok">合并</button><button type="button" class="admin-button" data-merge="cancel">取消</button></div>' +
      "</div></section>";
    document.body.append(modal);
    const finish = (value: boolean) => {
      modal.remove();
      resolve(value);
    };
    modal.addEventListener("click", (event) => {
      const choice = (event.target as Element).closest<HTMLElement>("[data-merge]")?.dataset.merge;
      if (!choice) return;
      finish(choice === "ok");
    });
    modal.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      finish(false);
    });
    $<HTMLButtonElement>('[data-merge="ok"]', modal)?.focus();
  });
}

function promptBulkRename(names: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "admin-icon-modal";
    modal.innerHTML =
      '<button type="button" class="admin-icon-modal__scrim" data-bulk="cancel" aria-label="取消"></button>' +
      '<section class="admin-icon-modal__panel admin-merge-panel" role="dialog" aria-modal="true" aria-label="批量重命名">' +
      '<header class="admin-icon-modal__head"><h2>批量重命名</h2><button type="button" class="admin-icon-btn" data-bulk="cancel" aria-label="取消">×</button></header>' +
      '<div class="admin-icon-modal__body">' +
      '<p class="admin-merge-text">选中的 ' + names.length + " 个标签会统一改成下面的名称，书签不会丢失。</p>" +
      '<input class="tag-rename-input" data-bulk-input maxlength="24" value="' + esc(names.length === 1 ? names[0] : "") + '" placeholder="输入新的标签名" aria-label="新的标签名">' +
      '<div class="admin-merge-actions"><button type="button" class="admin-button admin-button--primary" data-bulk="ok">确定</button><button type="button" class="admin-button" data-bulk="cancel">取消</button></div>' +
      "</div></section>";
    document.body.append(modal);
    const input = $<HTMLInputElement>("[data-bulk-input]", modal);
    const finish = (value: string | null) => {
      modal.remove();
      resolve(value);
    };
    modal.addEventListener("click", (event) => {
      const choice = (event.target as Element).closest<HTMLElement>("[data-bulk]")?.dataset.bulk;
      if (!choice) return;
      finish(choice === "ok" ? input?.value ?? "" : null);
    });
    modal.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(input?.value ?? "");
      } else if (event.key === "Escape") {
        event.stopPropagation();
        finish(null);
      }
    });
    input?.focus();
    input?.select();
  });
}

/** 批量重命名 = 把选中的多个标签统一改成同一个名字（等同批量合并） */
async function bulkRenameTags(): Promise<void> {
  const names = [...state.tagSelected];
  if (!names.length) return;
  const entered = await promptBulkRename(names);
  if (entered === null) return;
  const to = entered.replace(/[#\r\n\t]/g, " ").trim().slice(0, 24);
  if (!to) {
    toast("标签名不能为空", "error");
    return;
  }
  const keys = new Set(names.map((name) => name.toLowerCase()));
  const target = state.tags.find(
    (tag) => tag.name.toLowerCase() === to.toLowerCase() && !keys.has(tag.name.toLowerCase()),
  );
  let merge = false;
  if (target) {
    const confirmed = await confirmTagMerge("选中的 " + names.length + " 个标签", target);
    if (!confirmed) return;
    merge = true;
  }
  try {
    const result = await api<{ changed: number; merged: boolean; target: string; truncated: number }>(
      "/api/admin/tags/bulk-rename",
      { method: "POST", body: { names, to: merge && target ? target.name : to, merge } },
    );
    state.tagSelected.clear();
    state.tagEditing = null;
    const suffix = result.truncated ? "；" + result.truncated + " 个书签因超过 8 个标签被截断" : "";
    toast("已统一为「" + result.target + "」，更新 " + result.changed + " 个书签" + suffix);
    await loadTags();
  } catch (error) {
    toast(error instanceof Error ? error.message : "批量重命名失败", "error");
  }
}

async function renameTag(from: string, to: string, merge: boolean): Promise<void> {
  try {
    const result = await api<{ changed: number; merged: boolean; target: string; truncated: number }>(
      "/api/admin/tags/rename",
      { method: "POST", body: { from, to, merge } },
    );
    state.tagEditing = null;
    state.tagSelected.delete(from);
    const suffix = result.truncated
      ? "；" + result.truncated + " 个书签因超过 8 个标签被截断"
      : "";
    toast(
      result.merged
        ? "已合并到「" + result.target + "」，更新 " + result.changed + " 个书签" + suffix
        : "已重命名为「" + result.target + "」，更新 " + result.changed + " 个书签",
    );
    await loadTags();
  } catch (error) {
    toast(error instanceof Error ? error.message : "重命名失败", "error");
    state.tagEditing = null;
    renderTagsRegion();
  }
}

async function removeTags(names: string[]): Promise<void> {
  const list = names.filter(Boolean);
  if (!list.length) return;
  const label = list.length === 1 ? "标签「" + list[0] + "」" : list.length + " 个标签";
  if (!window.confirm("确定删除" + label + "吗？它会从所有书签里移除，书签本身不会被删除。")) return;
  try {
    const result = await api<{ changed: number }>("/api/admin/tags/remove", {
      method: "POST",
      body: { names: list },
    });
    state.tagSelected.clear();
    state.tagEditing = null;
    toast("已删除，更新 " + result.changed + " 个书签");
    await loadTags();
  } catch (error) {
    toast(error instanceof Error ? error.message : "删除失败", "error");
  }
}

/* ---------- pages ---------- */

async function loadPages(): Promise<void> {
  const data = await api<{ pages: AdminPage[] }>("/api/admin/pages");
  state.pages = data.pages;
  frame(renderPages());
  bindPageActions();
}

const BUILTIN_PAGE_PATHS: Record<string, string> = { home: "/", about: "/about" };

function renderPages(): string {
  return (
    pageHead("独立页面", "拖拽调整导航顺序；首页与关于页是内置页面，只能改内容、不能删除。", button("新增页面", "new-page", "primary")) +
    '<div class="admin-list">' +
    state.pages
      .map((page) => {
        const builtin = page.slug in BUILTIN_PAGE_PATHS;
        const path = BUILTIN_PAGE_PATHS[page.slug] ?? "/page/" + page.slug;
        const badge = builtin ? "内置" : page.isPublished ? "已发布" : "草稿";
        return (
          '<div class="page-row" data-drag-id="' + page.id + '" draggable="true"><span class="drag-handle">⠿</span><div class="page-main"><b>' +
          esc(page.title) + "</b><span>" + esc(path) + " · " + num(page.views) + ' 次浏览</span></div><span class="admin-badge ' +
          (!builtin && page.isPublished ? "ok" : "") + '">' + badge + '</span><div class="row-actions"><button type="button" class="admin-text-btn" data-action="edit-page" data-id="' +
          page.id + '">编辑</button>' +
          (builtin
            ? ""
            : '<button type="button" class="admin-text-btn danger" data-action="delete-page" data-id="' + page.id + '">删除</button>') +
          "</div></div>"
        );
      })
      .join("") +
    (state.pages.length ? "" : '<div class="admin-empty">还没有独立页面。</div>') +
    "</div>"
  );
}

function bindPageActions(): void {
  $$<HTMLElement>('[data-action="edit-page"]').forEach((el) =>
    el.addEventListener("click", () => {
      const page = state.pages.find((item) => item.id === Number(el.dataset.id));
      if (page) openPageForm(page);
    }),
  );
  $$<HTMLElement>('[data-action="delete-page"]').forEach((el) => el.addEventListener("click", () => removePage(Number(el.dataset.id))));
  $<HTMLElement>('[data-action="about-settings"]')?.addEventListener("click", () => navigate("settings"));
  enablePageDrag();
}

function openPageForm(page?: AdminPage): void {
  openDrawer(
    page ? "编辑页面" : "新增页面",
    '<form class="admin-form" data-form="page" data-id="' + (page?.id ?? "") + '">' +
      '<div class="form-grid">' + field("页面标题", '<input name="title" required maxlength="80" value="' + esc(page?.title ?? "") + '">') + field("路径（选填）", '<input name="slug" maxlength="80" value="' + esc(page?.slug ?? "") + '" placeholder="自动生成">') + "</div>" +
      field("摘要", '<input name="excerpt" maxlength="300" value="' + esc(page?.excerpt ?? "") + '">', "full") +
      '<div class="form-field full"><div class="md-field-head"><span>页面内容（Markdown）</span><button type="button" class="admin-text-btn" data-action="preview-page">预览 Markdown</button></div>' +
      '<textarea name="content" rows="16" data-page-content>' + esc(page?.content ?? "") + "</textarea>" +
      '<div class="md-preview" data-page-preview hidden></div></div>' +
      '<div class="form-inline"><label class="check-row"><input type="checkbox" name="showInNav" ' + (page?.showInNav === false ? "" : "checked") + "> 显示在导航</label><label class=\"check-row\"><input type=\"checkbox\" name=\"isPublished\" " + (page?.isPublished === false ? "" : "checked") + "> 发布</label></div>" +
      '<div class="drawer-actions"><button type="submit" class="admin-button admin-button--primary">保存页面</button></div></form>',
  );
  bindMarkdownPreview("preview-page", "[data-page-content]", "[data-page-preview]");
}

async function removePage(id: number): Promise<void> {
  if (!window.confirm("确定删除这个页面吗？相关评论也会删除。")) return;
  try {
    await api("/api/admin/pages/" + id, { method: "DELETE" });
    toast("页面已删除");
    await loadPages();
  } catch (error) {
    toast(error instanceof Error ? error.message : "删除失败", "error");
  }
}

function enablePageDrag(): void {
  const list = $<HTMLElement>(".admin-list");
  if (!list) return;
  let dragged: HTMLElement | null = null;
  $$<HTMLElement>(".page-row[data-drag-id]", list).forEach((row) => {
    row.addEventListener("dragstart", (event) => {
      dragged = row;
      row.classList.add("dragging");
      event.dataTransfer?.setData("text/plain", row.dataset.dragId ?? "");
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => {
      dragged = null;
      $$(".dragging, .drag-over", list).forEach((el) => el.classList.remove("dragging", "drag-over"));
    });
    row.addEventListener("dragover", (event) => {
      if (!dragged || dragged === row) return;
      event.preventDefault();
      row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      if (!dragged || dragged === row) return;
      row.classList.remove("drag-over");
      row.before(dragged);
      const ids = $$<HTMLElement>(".page-row[data-drag-id]", list).map((item) => Number(item.dataset.dragId));
      void reorder("pages", ids);
    });
  });
}

/* ---------- comments ---------- */

async function loadComments(page = state.commentPage): Promise<void> {
  const size = state.commentPageSize;
  const data = await api<{ comments: AdminComment[]; total: number; page: number }>(
    "/api/admin/comments?status=" + state.commentFilter + "&page=" + page + "&pageSize=" + (size === 0 ? 0 : size),
  );
  state.comments = data.comments;
  state.commentsTotal = data.total;
  state.commentPage = data.page;
  frame(renderComments(data.total));
  bindCommentActions();
}

/** 来源信息：归属地 / IP / 系统 · 浏览器，历史评论没有这些字段就提示一下 */
function commentSourceHtml(comment: AdminComment): string {
  if (!comment.ip && !comment.device && !comment.browser) {
    return '<div class="comment-admin__source"><span class="comment-admin__chip comment-admin__chip--muted">未记录来源信息</span></div>';
  }
  // UA 展示成「系统 + 版本 · 浏览器 + 版本」；老数据没有 os，退回设备类型
  const client = [comment.os || comment.device, comment.browser].filter(Boolean).join(" · ");
  return (
    '<div class="comment-admin__source">' +
    '<span class="comment-admin__chip">IP属地：' + esc(comment.ipProvince || "未知") + "</span>" +
    (comment.ip ? '<span class="comment-admin__chip">' + esc(comment.ip) + "</span>" : "") +
    (client ? '<span class="comment-admin__chip">' + esc(client) + "</span>" : "") +
    "</div>"
  );
}

function commentCardHtml(comment: AdminComment): string {
  const statusLabel = comment.status === "approved" ? "已发布" : comment.status === "spam" ? "垃圾" : "待审核";
  const targetHref = (comment.targetType === "page" ? "/page/" : "/site/") + encodeURIComponent(comment.targetSlug);
  const sep = '<span class="comment-admin__sep">·</span>';
  // 填了个人网址：用户名本身就是入口（蓝色链接），不再重复展示“个人主页”
  const author = comment.website
    ? '<a class="comment-admin__author" href="' + esc(comment.website) + '" target="_blank" rel="noopener noreferrer nofollow ugc">' + esc(comment.author) + "</a>"
    : "<b>" + esc(comment.author) + "</b>";
  return (
    '<article class="comment-admin">' +
    '<div class="comment-admin__head"><span class="comment-admin__title">' + author +
    '<span class="comment-admin__sub">' + esc(comment.email || "未留邮箱") + sep + shortDate(comment.createdAt) +
    sep + '评论于 <a href="' + targetHref + '" target="_blank" rel="noopener">' + esc(comment.targetName) + "</a>" +
    "</span></span>" +
    '<span class="admin-badge">' + statusLabel + "</span></div>" +
    commentSourceHtml(comment) +
    "<p>" + esc(comment.content) + "</p>" +
    '<div class="comment-admin__actions">' +
    (comment.status !== "approved" ? '<button type="button" class="admin-text-btn" data-action="comment-status" data-id="' + comment.id + '" data-status="approved">通过</button>' : "") +
    (comment.status !== "spam" ? '<button type="button" class="admin-text-btn" data-action="comment-status" data-id="' + comment.id + '" data-status="spam">垃圾</button>' : "") +
    (comment.status !== "pending" ? '<button type="button" class="admin-text-btn" data-action="comment-status" data-id="' + comment.id + '" data-status="pending">待审</button>' : "") +
    '<button type="button" class="admin-text-btn danger" data-action="delete-comment" data-id="' + comment.id + '">删除</button>' +
    "</div></article>"
  );
}

function renderComments(total: number): string {
  // 顺序固定：全部 → 待审核 → 垃圾 → 已发布
  const filters: Array<[CommentFilter, string]> = [
    ["all", "全部"],
    ["pending", "待审核"],
    ["spam", "垃圾"],
    ["approved", "已发布"],
  ];
  const pages = pageCount(total, state.commentPageSize);
  return (
    pageHead("评论", total + " 条记录，站点与独立页面评论统一审核。") +
    '<div class="admin-filter">' +
    filters.map(([id, label]) => '<button type="button" class="admin-filter__btn' + (state.commentFilter === id ? " active" : "") + '" data-comment-filter="' + id + '">' + label + "</button>").join("") +
    "</div>" +
    // 与书签、标签页一致：列表和分页器放在同一个 region 里，靠 10px gap 拉开
    '<div class="admin-table-region">' +
    '<div class="comment-admin-list">' +
    (state.comments.length ? state.comments.map(commentCardHtml).join("") : '<div class="admin-empty">这里还没有评论。</div>') +
    "</div>" +
    pagerHtml({
      id: "comments-pager",
      total,
      page: state.commentPage,
      pages,
      pageSize: state.commentPageSize,
      sizes: COMMENT_PAGE_SIZE_OPTIONS,
      sizeFallback: DEFAULT_COMMENT_PAGE_SIZE,
    }) +
    "</div>"
  );
}

function goCommentPage(page: number): void {
  const pages = pageCount(state.commentsTotal, state.commentPageSize);
  const target = Math.min(Math.max(1, Math.round(page) || 1), pages);
  if (!Number.isFinite(target) || target === state.commentPage) return;
  void loadComments(target);
}

function bindCommentActions(): void {
  $$<HTMLButtonElement>("[data-comment-filter]").forEach((el) =>
    el.addEventListener("click", () => {
      state.commentFilter = el.dataset.commentFilter as CommentFilter;
      state.commentPage = 1;
      void loadComments(1);
    }),
  );
  $$<HTMLElement>('[data-action="comment-status"]').forEach((el) =>
    el.addEventListener("click", () => setCommentStatus(Number(el.dataset.id), el.dataset.status ?? "pending")),
  );
  $$<HTMLElement>('[data-action="delete-comment"]').forEach((el) => el.addEventListener("click", () => removeComment(Number(el.dataset.id))));
  bindPager($<HTMLElement>("#comments-pager"), goCommentPage, (size) => {
    if (size === state.commentPageSize) return;
    state.commentPageSize = size;
    storePageSize(COMMENT_PAGE_SIZE_KEY, size);
    void loadComments(1);
  });
}

async function setCommentStatus(id: number, status: string): Promise<void> {
  try {
    await api("/api/admin/comments/" + id, { method: "PATCH", body: { status } });
    toast("评论状态已更新");
    await loadComments();
  } catch (error) {
    toast(error instanceof Error ? error.message : "更新失败", "error");
  }
}

async function removeComment(id: number): Promise<void> {
  if (!window.confirm("确定永久删除这条评论吗？")) return;
  try {
    await api("/api/admin/comments/" + id, { method: "DELETE" });
    toast("评论已删除");
    await loadComments();
  } catch (error) {
    toast(error instanceof Error ? error.message : "删除失败", "error");
  }
}

/* ---------- settings ---------- */

async function loadSettings(): Promise<void> {
  const data = await api<AdminSettingsPayload>("/api/admin/settings");
  state.settings = data.settings;
  state.siteName = data.settings.siteName || state.siteName;
  state.aiKeys = data.aiKeys as unknown as Record<string, boolean>;
  state.aiApiKeySet = !!data.aiApiKeySet;
  state.githubOauthConfigured = data.githubOauthConfigured;
  frame(renderSettings());
  bindSettings();
}

function field(label: string, input: string, className = ""): string {
  return '<label class="form-field ' + className + '"><span>' + esc(label) + "</span>" + input + "</label>";
}

function selectProvider(value: string): string {
  return AI_PROVIDER_PRESETS.map(
    (preset) =>
      '<option value="' + preset.id + '"' + (preset.id === value ? " selected" : "") + ">" + esc(preset.label) + "</option>",
  ).join("");
}

function renderSettings(): string {
  const s = state.settings!;
  const aiConfigured = Object.entries(state.aiKeys)
    .filter(([, value]) => value)
    .map(([key]) => key)
    .join("、");
  const preset = aiProviderPreset(s.aiProvider);
  const promptVars = AI_PROMPT_VARIABLES.map((item) => "{" + item.key + "} " + item.label).join(" · ");
  return (
    pageHead("设置", "前台文案、评论策略和 AI 配置。") +
    '<form class="admin-form settings-form" data-form="settings">' +
    '<section class="settings-section"><h2>站点信息</h2><div class="form-grid">' +
    field("站点名称", '<input name="siteName" required maxlength="60" value="' + esc(s.siteName) + '">') +
    field("一句话介绍", '<input name="siteTagline" maxlength="160" value="' + esc(s.siteTagline) + '">') +
    "</div>" +
    field("站点描述", '<textarea name="siteDescription" rows="3" maxlength="500">' + esc(s.siteDescription) + "</textarea>", "full") +
    field("页脚文案", '<input name="footerText" maxlength="300" value="' + esc(s.footerText) + '">', "full") +
    field("SEO 关键词", '<input name="seoKeywords" maxlength="300" value="' + esc(s.seoKeywords) + '">', "full") +
    "</section>" +
    '<section class="settings-section"><h2>评论</h2><div class="form-inline"><label class="check-row"><input type="checkbox" name="commentsEnabled" ' + (s.commentsEnabled ? "checked" : "") + "> 启用评论</label><label class=\"check-row\"><input type=\"checkbox\" name=\"commentModeration\" " + (s.commentModeration ? "checked" : "") + "> 审核后发布</label></div>" + field("屏蔽词（逗号分隔）", '<textarea name="bannedWords" rows="3">' + esc(s.bannedWords) + "</textarea>", "full") + "</section>" +
    '<section class="settings-section"><h2>AI 简介</h2><div class="form-grid">' +
    field("服务", '<select name="aiProvider" data-ai-provider>' + selectProvider(s.aiProvider) + "</select>") +
    field("模型", '<input name="aiModel" value="' + esc(s.aiModel) + '" placeholder="' + esc(preset.model || "必填") + '" data-ai-model>') +
    field("接口地址（选填）", '<input name="aiBaseUrl" value="' + esc(s.aiBaseUrl) + '" placeholder="' + esc(preset.baseUrl || "必填，例如 https://api.example.com/v1") + '" data-ai-base>') +
    field(
      "API Key（仅自定义接口需要）",
      '<div class="key-field"><input name="aiApiKey" type="password" autocomplete="new-password" maxlength="300" placeholder="' +
        (state.aiApiKeySet ? "已保存在设置中，留空表示不修改" : "留空则读取环境变量里的密钥") +
        '"><button type="button" class="admin-text-btn" data-action="clear-ai-key"' + (state.aiApiKeySet ? "" : " hidden") + ">清除</button></div>",
    ) +
    "</div>" +
    '<p class="admin-muted">' +
    (aiConfigured ? "已检测到密钥：" + esc(aiConfigured) : "未检测到 AI 密钥，保存书签时不会自动生成简介。") +
    " 环境变量名：QWEN_API_KEY / DASHSCOPE_API_KEY、ARK_API_KEY、DEEPSEEK_API_KEY、GEMINI_API_KEY、AI_API_KEY。</p>" +
    '<div class="md-field-head"><span>提示词模板</span><button type="button" class="admin-text-btn" data-action="reset-ai-prompt">恢复默认</button></div>' +
    '<textarea name="aiPrompt" rows="12" spellcheck="false" class="ai-prompt">' + esc(s.aiPrompt) + "</textarea>" +
    '<p class="admin-muted">可用变量：' + esc(promptVars) + "。某一行引用的变量为空时，该行会被自动省略。</p>" +
    '<p class="admin-muted">保存书签时如果简介留空，会在响应返回后由后台任务生成，列表里显示「AI 生成中」；失败原因会记在书签行上，点一下即可重试。</p>' +
    "</section>" +
    '<section class="settings-section"><h2>管理员</h2>' + field("GitHub 管理员（逗号分隔）", '<input name="githubAdmins" value="' + esc(s.githubAdmins) + '">', "full") + '<p class="admin-muted">' + (state.githubOauthConfigured ? "GitHub OAuth 已配置。" : "GitHub OAuth 尚未配置。") + "</p></section>" +
    '<div class="drawer-actions"><button type="submit" class="admin-button admin-button--primary">保存设置</button></div></form>'
  );
}

/** 切换服务时同步「模型 / 接口地址」的占位与默认值，避免沿用上一个供应商的值 */
function applyProviderHint(resetValues: boolean): void {
  const select = $<HTMLSelectElement>("select[data-ai-provider]");
  if (!select) return;
  const preset = aiProviderPreset(select.value as SiteSettings["aiProvider"]);
  const model = $<HTMLInputElement>("input[data-ai-model]");
  const base = $<HTMLInputElement>("input[data-ai-base]");
  if (model) {
    model.placeholder = preset.model || "必填";
    if (resetValues) model.value = preset.model;
  }
  if (base) {
    base.placeholder = preset.baseUrl || "必填，例如 https://api.example.com/v1";
    if (resetValues) base.value = "";
  }
}

function bindSettings(): void {
  const select = $<HTMLSelectElement>("select[data-ai-provider]");
  if (!select) return;
  select.addEventListener("change", () => applyProviderHint(true));
}

/* ---------- drawer/forms ---------- */

function openDrawer(title: string, body: string): void {
  document.body.classList.add("admin-drawer-open");
  const wrapper = document.createElement("div");
  wrapper.className = "admin-drawer";
  wrapper.innerHTML =
    '<button type="button" class="admin-drawer__scrim" data-action="close-drawer" aria-label="关闭"></button>' +
    '<section class="admin-drawer__panel" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
    '<header class="admin-drawer__head"><h2>' + esc(title) + '</h2><button type="button" class="admin-icon-btn" data-action="close-drawer" aria-label="关闭">×</button></header>' +
    '<div class="admin-drawer__body">' + body + "</div></section>";
  document.body.append(wrapper);
  $<HTMLElement>(".admin-drawer__panel")?.addEventListener("click", (event) => event.stopPropagation());
  $$<HTMLElement>('[data-action="close-drawer"]', wrapper).forEach((el) => el.addEventListener("click", closeDrawer));
  $<HTMLElement>('[data-action="ai-site"]')?.addEventListener("click", generateSiteDescription);
}

function closeDrawer(): void {
  document.body.classList.remove("admin-drawer-open");
  $(".admin-drawer")?.remove();
}

async function generateSiteDescription(): Promise<void> {
  const id = $<HTMLElement>('[data-action="ai-site"]')?.dataset.id;
  if (!id) return;
  const buttonEl = $<HTMLButtonElement>('[data-action="ai-site"]');
  if (buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = "生成中…";
  }
  try {
    const result = await api<{ description: string; provider: string }>("/api/admin/sites/" + id + "/generate-description", { method: "POST", body: {} });
    const textarea = $<HTMLTextAreaElement>('textarea[name="description"]');
    if (textarea) textarea.value = result.description;
    toast("简介已生成");
  } catch (error) {
    toast(error instanceof Error ? error.message : "生成失败", "error");
  } finally {
    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.textContent = "AI 重写简介";
    }
  }
}

/** 正在盯着的 AI 任务，避免同一书签重复起多个轮询 */
const aiWatch = new Set<number>();

/**
 * 轮询后台 AI 简介任务：每 3 秒问一次这个书签，pending 结束后刷新列表并提示结果。
 * 最多盯 30 次（约 90 秒），超过就放弃，用户可以手动点「重试」。
 */
function watchAiDescription(siteId: number, attempt = 0): void {
  window.setTimeout(async () => {
    try {
      const site = await api<AdminSite>("/api/admin/sites/" + siteId);
      if (!site.aiPending) {
        aiWatch.delete(siteId);
        await loadSites();
        if (site.aiError) toast("AI 简介生成失败：" + site.aiError, "error");
        else toast("AI 简介已生成");
        return;
      }
    } catch {
      // 单次请求失败不终止轮询
    }
    if (attempt + 1 >= 30) {
      aiWatch.delete(siteId);
      return;
    }
    watchAiDescription(siteId, attempt + 1);
  }, 3000);
}

function trackAiDescription(siteId: number): void {
  if (aiWatch.has(siteId)) return;
  aiWatch.add(siteId);
  watchAiDescription(siteId);
}

/** 列表行上的「AI 失败 · 重试」：重新排一次后台任务，不等接口返回 */
async function retryAiDescription(id: string): Promise<void> {
  try {
    await api("/api/admin/sites/" + id + "/generate-description", { method: "POST", body: { async: true } });
    await loadSites();
    toast("已重新排队生成简介");
    trackAiDescription(Number(id));
  } catch (error) {
    toast(error instanceof Error ? error.message : "重试失败", "error");
  }
}

function formValue(data: FormData, name: string): string {
  return String(data.get(name) ?? "").trim();
}

function formChecked(data: FormData, name: string): boolean {
  return data.get(name) === "on";
}

async function submitSiteForm(form: HTMLFormElement): Promise<void> {
  const data = new FormData(form);
  const id = form.dataset.id;
  const payload = {
    name: formValue(data, "name"),
    url: formValue(data, "url"),
    categoryId: Number(formValue(data, "categoryId")),
    description: formValue(data, "description"),
    tags: formValue(data, "tags")
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean),
    iconUrl: formValue(data, "iconUrl"),
    screenshotUrl: formValue(data, "screenshotUrl"),
    detailContent: formValue(data, "detailContent"),
  };
  try {
    const result = await api<{ site: AdminSite | null; aiQueued?: boolean }>(
      id ? "/api/admin/sites/" + id : "/api/admin/sites",
      { method: id ? "PUT" : "POST", body: payload },
    );
    closeDrawer();
    const saved = result.site;
    const aiPending = saved ? aiPendingVisible(saved) : false;
    if (aiPending) {
      toast(id ? "已更新，AI 简介正在后台生成…" : "已创建，AI 简介正在后台生成…");
    } else {
      toast(id ? "书签已更新" : "书签已创建");
    }
    await loadSites();
    // 后台生成不阻塞保存，这里盯着它，生成完自动刷表格
    if (saved && aiPending) trackAiDescription(saved.id);
  } catch (error) {
    toast(error instanceof Error ? error.message : "保存失败", "error");
  }
}

async function submitCategoryForm(form: HTMLFormElement): Promise<void> {
  const data = new FormData(form);
  const id = form.dataset.id;
  const payload = {
    name: formValue(data, "name"),
    parentId: formValue(data, "parentId") ? Number(formValue(data, "parentId")) : null,
    icon: formValue(data, "icon"),
    slug: formValue(data, "slug"),
    description: formValue(data, "description"),
  };
  try {
    await api(id ? "/api/admin/categories/" + id : "/api/admin/categories", { method: id ? "PUT" : "POST", body: payload });
    closeDrawer();
    toast(id ? "分类已更新" : "分类已创建");
    await loadCategories();
  } catch (error) {
    toast(error instanceof Error ? error.message : "保存失败", "error");
  }
}

async function submitPageForm(form: HTMLFormElement): Promise<void> {
  const data = new FormData(form);
  const id = form.dataset.id;
  const payload = {
    title: formValue(data, "title"),
    slug: formValue(data, "slug"),
    excerpt: formValue(data, "excerpt"),
    content: formValue(data, "content"),
    showInNav: formChecked(data, "showInNav"),
    isPublished: formChecked(data, "isPublished"),
  };
  try {
    await api(id ? "/api/admin/pages/" + id : "/api/admin/pages", { method: id ? "PUT" : "POST", body: payload });
    closeDrawer();
    toast(id ? "页面已更新" : "页面已创建");
    await loadPages();
  } catch (error) {
    toast(error instanceof Error ? error.message : "保存失败", "error");
  }
}

async function submitSettingsForm(form: HTMLFormElement): Promise<void> {
  const data = new FormData(form);
  const payload: Record<string, unknown> = {
    siteName: formValue(data, "siteName"),
    siteTagline: formValue(data, "siteTagline"),
    siteDescription: formValue(data, "siteDescription"),
    footerText: formValue(data, "footerText"),
    seoKeywords: formValue(data, "seoKeywords"),
    commentsEnabled: formChecked(data, "commentsEnabled"),
    commentModeration: formChecked(data, "commentModeration"),
    bannedWords: formValue(data, "bannedWords"),
    aiProvider: formValue(data, "aiProvider"),
    aiModel: formValue(data, "aiModel"),
    aiBaseUrl: formValue(data, "aiBaseUrl"),
    aiPrompt: formValue(data, "aiPrompt"),
    githubAdmins: formValue(data, "githubAdmins"),
  };
  // 密钥留空表示“不修改”：只有真的填写了才提交，避免覆盖已保存的密钥
  const apiKey = formValue(data, "aiApiKey");
  if (apiKey) payload.aiApiKey = apiKey;
  try {
    await api("/api/admin/settings", { method: "PUT", body: payload });
    toast("设置已保存");
    await loadSettings();
  } catch (error) {
    toast(error instanceof Error ? error.message : "保存失败", "error");
  }
}

/* ---------- global events ---------- */

document.addEventListener("submit", (event) => {
  const form = (event.target as HTMLElement).closest<HTMLFormElement>("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const kind = form.dataset.form;
  if (kind === "site") void submitSiteForm(form);
  else if (kind === "category") void submitCategoryForm(form);
  else if (kind === "page") void submitPageForm(form);
  else if (kind === "settings") void submitSettingsForm(form);
});

document.addEventListener("click", (event) => {
  const target = event.target as Element;
  const tagEl = target.closest<HTMLElement>("[data-tag-action]");
  if (tagEl) {
    handleTagAction(tagEl.dataset.tagAction ?? "", tagEl);
    return;
  }
  const actionEl = target.closest<HTMLElement>("[data-action]");
  const action = actionEl?.dataset.action;
  if (!action) return;
  if (action === "close-drawer") {
    closeDrawer();
    return;
  }
  if (action === "new-site") openSiteForm();
  else if (action === "new-category") openCategoryForm();
  else if (action === "new-page") openPageForm();
  else if (action === "check-links") void checkLinks();
  else if (action === "retry-ai") void retryAiDescription(actionEl?.dataset.id ?? "");
  else if (action === "clear-ai-key") void clearAiKey();
  else if (action === "reset-ai-prompt") resetAiPrompt();
});

async function clearAiKey(): Promise<void> {
  try {
    await api("/api/admin/settings", { method: "PUT", body: { aiApiKey: "" } });
    toast("已清除自定义接口密钥");
    await loadSettings();
  } catch (error) {
    toast(error instanceof Error ? error.message : "清除失败", "error");
  }
}

function resetAiPrompt(): void {
  const area = $<HTMLTextAreaElement>('textarea[name="aiPrompt"]');
  if (!area) return;
  area.value = DEFAULT_AI_PROMPT;
  toast("已恢复默认提示词，记得点保存设置");
}

async function checkLinks(): Promise<void> {
  try {
    toast("正在检测，请稍候…");
    const result = await api<{ checked: number }>("/api/admin/check-all", { method: "POST", body: { limit: 10 } });
    toast("已检测 " + result.checked + " 个链接");
    await loadSites();
  } catch (error) {
    toast(error instanceof Error ? error.message : "检测失败", "error");
  }
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDrawer();
});

window.addEventListener("popstate", () => {
  if (!state.user) return;
  void navigate(tabFromPath(), false);
});

void boot();
