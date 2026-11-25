# AGENTS.md — 锦囊书签 / iNav 二次开发交接

本文件面向 Codex 或其他 AI 编码代理。开始修改前请完整阅读 README、本文件、wrangler.jsonc 和 migrations/。

文档分工：`README.md` 给使用者看（功能、快速开始、部署入口），不写 CSS 数值与实现细节；实现约定、产品决策、踩过的坑全部写在本文件；部署每一步的操作与排错写在 `DEPLOY.md`。

## 1. 项目定位

一个部署在 Cloudflare Workers + D1 SQLite 上的公开网址导航站：

- 前台：原生 TypeScript + History API + 原生 DOM，无运行时框架。
- 后台：原生 TypeScript + 原生 DOM，入口 /admin，不使用 React。
- 数据：Cloudflare D1；静态资源：Workers Static Assets（./dist）。
- 认证：仅 GitHub OAuth；没有本地快捷登录。
- 构建：Vite；Node.js >= 22.12。
- 生产 Worker 入口：worker/index.ts。
- 许可：CC BY-NC-SA 4.0（非商业 + 相同方式共享），见 LICENSE。新增文件不要引入冲突许可，第三方依赖/资源保留其原许可（Hono、Vite、Wrangler 为 MIT，Lucide 为 ISC）。

## 2. 快速开始

```bash
npm install
npm run setup         # = db:migrate + db:seed，建本地 D1 并写入演示数据
npm run dev           # 构建后启动 127.0.0.1:8787
```

单独开发：

```bash
npm run dev:worker    # Workers API + 静态资源（推荐）
npm run dev:ui        # Vite 前台 HMR，API 代理到 8787
```

命令：

```bash
npm run typecheck
npm run build          # 类型检查 + 图标一致性校验 + Vite 打包
npm run icons:check    # 只校验图标产物（build 已包含）
npm run icons:build    # 改 lucide-groups.json 或升级 lucide-static 后重新生成产物
npm run test:api      # 公开面 API 冒烟检查
npm run db:migrate
npm run db:migrate:remote
npm run db:seed
npm run deploy
```

后台需要 GitHub OAuth。本地创建不被提交的 .dev.vars：

```dotenv
SESSION_SECRET=至少16位随机字符串
SITE_URL=http://127.0.0.1:8787
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
ADMIN_GITHUB_LOGINS=你的GitHub用户名
```

GitHub OAuth App 回调：本地 http://127.0.0.1:8787/api/auth/github/callback；线上 https://你的域名/api/auth/github/callback。

没有 OAuth 时，/admin 只显示 GitHub OAuth 未配置，不存在调试登录入口。

## 3. 生产部署

完整步骤与排错见 `DEPLOY.md`，这里只记与本仓库强相关的约束：

- `wrangler.jsonc` 里 `database_name = "inav"`，未写 `database_id`，wrangler 按名字解析；**不要**把 `database_id` 换成别的库。
- 5 个必需 Secret：`SESSION_SECRET`、`SITE_URL`、`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`、`ADMIN_GITHUB_LOGINS`；AI Key 按需。
- 部署入口统一是 `npm run deploy`（= `build` + 远程 D1 迁移 + `wrangler deploy`），CI 用 `npm run build` + 迁移 + `wrangler deploy`，语义一致。
- README 顶部的 Deploy to Cloudflare 按钮读 `wrangler.jsonc` 自动建 D1（按 `database_name`）、读 `.dev.vars.example` 收集 Secret、读 `package.json` 的 `build`/`deploy` 脚本；改这三处要同时保证按钮流程还能跑通。
- 正式站**不要**跑 `db:seed:remote`（会插入 52 条演示站点）。
- 线上库已应用过 `0001`，改动这个文件不会自动重放，结构变更需手工 `wrangler d1 execute` 并同步文件。
- 提交前确认没有 `.dev.vars`、`.wrangler`、`dist`、`node_modules`、密钥、本地数据库。

## 4. 代码结构

```text
index.html                 前台入口
admin.html                 后台入口
src/public/main.ts         前台路由、渲染、评论、统计
src/public/styles.css      前台样式
src/admin/main.ts          后台全部逻辑（无框架）
src/lib/markdown.ts        安全 Markdown 子集渲染器
src/lib/categoryIcons.ts   分类图标分组（读 lucide-groups.json）+ SVG 精灵引用
src/styles.css             后台样式
worker/index.ts            Hono 入口、安全头、/go、/admin、sitemap
worker/public.ts           导航、详情、页面、评论、验证码、浏览量
worker/admin.ts            书签/分类/标签/页面/评论/设置/检测/拖拽排序
worker/auth.ts             GitHub OAuth + 签名会话
worker/ai.ts               AI 简介（多供应商、提示词模板、密钥解析）
worker/commentmeta.ts      IP 属地（百度）+ UA 解析（设备/系统/浏览器）
worker/linkcheck.ts        链接检测
worker/utils.ts            映射、设置、URL/摘要工具
shared/types.ts            共享类型
shared/ai.ts               AI 供应商清单与默认提示词
src/lib/datetime.ts        北京时间格式化（parseDbTime / formatDate / timeAgo）
src/lib/categoryIcons.ts   图标选择（精选 sprite / 单图标文件）
src/lib/lucide-groups.json 精选图标分组
migrations/0001_init.sql   唯一的全量初始化脚本
public/                    headers、favicon、robots、Lucide 精灵、theme-init.js
scripts/seed.sql           演示数据
scripts/build-icon-sprite.mjs  生成 sprite / 单图标 / 名称表
scripts/check-icons.mjs    构建前校验图标产物与配置一致（只读）
scripts/reset-local-db.mjs 本地库重建（db:reset）
scripts/smoke-api.mjs      公开面 API 冒烟
docs/                      README 截图
```

## 5. 产品决策（不要无意改回）

### 浏览量

- 只有两个计数概念，界面文案不能混用：
  - **浏览**（view）= `sites.views`（详情页被打开几次）/ `pages.views`（独立页面被打开几次），用**眼睛图标** `eyeIcon()`；前台直接读这两列，不再有单独的计数表。
  - **跳转**（jump）= `sites.jumps`，外链被点开几次；卡片右上角、热门站点、详情页都用**外链箭头图标** `jumpIcon()`。
- 卡片、详情页访问按钮、域名、同分类链接跳转时 POST /api/sites/:id/jump，`jumps + 1` 且 `daily_stats.jumps + 1`；/go/:id 同样处理。
- 页面浏览由前端 `trackView(kind, id)` 发 `POST /api/views`，一次 batch 写两处：`sites.views|pages.views + 1`（累计）与 `daily_stats.views + 1`（今日总量）。服务端 GET 接口只读，不做自增。
- 首页（`slug=home`）与关于页（`slug=about`）也是 `pages` 里的行：首页那行只存访问计数（正文由前端渲染），关于页的正文就是它的 `content`，在后台「页面」tab 编辑，不再走设置。
- 关于页五+一个数字：「全站浏览」= `SUM(sites.views) + SUM(pages.views)`（`NavStats.totalViews`，含首页与关于页本身）；「全站跳转」= `SUM(sites.jumps)`（`NavStats.totalJumps`）；「今日浏览 / 今日跳转」= `daily_stats` 当天那一行的两列。
- 不记录、不展示单独 clicks。

### 评论

- 站点详情页与独立页面共用 comments，site_id / page_id 二选一。
- 称呼、邮箱、内容必填；个人网址选填；邮箱不公开。
- 填写网址后评论用户名可点击；评论时间和右栏最近评论支持 #comment-<id>。
- 评论统一进入后台“评论”审核。
- 验证码、蜜罐、IP 摘要、限流、去重、屏蔽词在 worker/public.ts。
- **来源信息**：`comments` 存 `ip / device / browser / os / ip_location`（**不存 UA 原文**，只存解析结果）。提交时 `clientIp()` 取 `CF-Connecting-IP`（兜底 X-Forwarded-For / X-Real-IP），`parseUserAgent()` 用正则判设备、系统、浏览器（顺序必须是 微信 → QQ → UC → Edge → Opera → Firefox → CriOS → Chrome → Safari，否则 Chrome 会被判成 Safari；系统顺序必须 Windows → iOS → HarmonyOS → Android → ChromeOS → macOS → Linux，否则 iPhone 的「like Mac OS X」会被判成 macOS、Android 会被判成 Linux）。**版本号统一为主.次一位小数**（`oneDecimal()`：UA 里没有次版本时补 `.0`），例如 `Windows 10/11`、`macOS 10.15`、`iOS 18.1`、`Android 14.0`、`Chrome 140.0`、`Safari 18.1`；后台展示成「系统 · 浏览器」。UA 读取时截到 400 字。
- 归属地在 `worker/commentmeta.ts`：百度 `https://opendata.baidu.com/api.php?query=<ip>&resource_id=6006&oe=utf8`，免费无 Key、返回中文；4s 超时，`waitUntil` 里补写，失败留空。内网/保留地址（127/10/192.168/172.16-31/100.64-127/fe80/fc/fd/::1）不查。**IPv6 该接口查不到，属正常**。前台只显示 `ipProvince`（`provinceOf()` 截到省/直辖市/自治区/特别行政区），后台显示 `ipLocation` 全称。
- 后台评论筛选按钮顺序固定为 **全部 → 待审核 → 垃圾 → 已发布**（`renderComments()` 的 `filters` 数组，默认停在待审核）。
- 后台评论列表：服务端分页（`page`/`pageSize`，`pageSize=0` 视为全部取 200 上限），复用 `pagerHtml`/`bindPager`，每页条数记忆在 `inav.admin.pageSize.comments`；卡片 CSS 是 `grid-template-columns: repeat(2, minmax(0,1fr))`，1080px 以下收一列。

### 后台

- 六个标签：书签、分类、标签、独立页面、评论、设置。
- 无概览页；链接检测按钮在书签页顶部。
- 标签栏只有文字，没有描述小字。
- 同级分类、独立页面拖拽排序；**书签没有排序字段**（`sites.sort_order` 已随 0014 删除），一律按 `id` 即添加顺序排列，后台无拖拽、无排序值输入，前台 `ORDER BY s.id`。
- 关于页固定最后（前台 `/about` 是硬编码路由，正文读 `pages.slug='about'`）；首页与关于页在后台「页面」tab 里只能编辑、不能删除，slug 也不可改。
- 后台顶栏顺序固定为「品牌名（锦囊书签 · 后台）→ 查看前台 → 右侧用户名/退出」，`查看前台` 用 `.admin-top__front` 紧跟品牌（`margin-left:-8px`），不要放回右侧操作区。
- `loadSites()` 只在 `state.tab === "sites"` 时 `frame(renderSites())`：检测链接、AI 简介轮询都是「在书签页发起、可能切走后才返回」，无条件重绘会把书签表格画到别的 tab 内容区，导航高亮却还停在原 tab。
- 书签编辑为单层右侧抽屉；详情 Markdown 有预览/返回编辑。独立页面编辑抽屉的「页面内容（Markdown）」同样带预览/返回编辑按钮（共用 `bindMarkdownPreview()`）。
- 标签是胶囊编辑器：已有标签可点选，新标签回车/添加；已选只能删除。**标签上限 8 个**（服务端 `worker/utils.ts` 的 `parseTags()` 同样截断到 8，前端 `SITE_TAG_LIMIT` 必须与之保持一致），输入行右侧显示 `n / 8` 计数，满 8 个后禁用已有标签建议并在继续添加时提示“最多 8 个标签，请先删除一个”。单个标签最长 24 字，去重忽略大小写。已有标签**统一按名称排序**（`localeCompare(zh-CN)`，即拼音序，不按使用次数排），每个标签后用灰色小字显示 `(使用次数)`，次数只做展示不参与排序；**全量渲染不截断**（不设内部滚动区，超过 `SUGGEST_PREVIEW = 16` 个折叠为“展开全部 (N) / 收起”），数据源为 `GET /api/admin/tags` 聚合（打开抽屉后异步校正一次，避免标签改名后不同步）；输入框带联想面板：边输入边匹配已有标签（顺序同上，也带次数），↑/↓ 选择、Enter 采用、Esc 只收起面板，无匹配时提示回车新建。
- 标签管理 tab：**不建 tags 表（方案 A）**，`GET /api/admin/tags` 实时聚合 `sites.tags` 的 JSON，同名忽略大小写，默认按使用次数降序。支持按标签名/书签数升降序排序（点表头切换）、搜索、行内重命名、批量重命名（选中多个统一改成一个名字，即批量合并）、单个/批量删除（勾选 + 全选）。重命名撞名时返回 409，前端弹“合并 / 取消”：合并 = 把源标签在所有书签里替换成已有标签的写法，再走 `parseTags()` 去重截断。没有“预置标签”能力，标签只能从书签里来。列名固定为“标签 / 书签数”，数值列居中。
- 分类图标是弹窗选择：**精选 404 个 / 12 组**（开发与运维、AI 与数据、设计与素材、阅读与内容、影音与娱乐、效率与办公、生活与购物、美食与厨房、家居与工具、自然与出行、动物与植物、通用与标记；整体偏具象化与经典图标），分组与顺序写在 `src/lib/lucide-groups.json`，用 `npm run icons:build` 从 `lucide-static` 重新生成 `public/category-icons.svg`（精选 404 个合成 sprite，142KB / gzip 27KB）、`public/icons/<name>.svg`（其余 1952 个各一个文件，约 500B/个，**已随仓库提交、不再 gitignore**）+ `public/lucide-names.json`（名称表 34KB）。三份产物都已入库，`npm run build` 只跑 `npm run icons:check` 校验、不重新生成；只有改 `lucide-groups.json` 或升级 `lucide-static` 时才跑 `npm run icons:build` 并提交产物。弹窗支持按名称子串搜索（先精选命中，再懒加载全库补 140 条），也支持自定义名称：校验 `/^[a-z0-9][a-z0-9-]*$/` 且必须在全库名单里，否则 toast 报错。
- 图标按名称自动选资源：精选名单内用 `/category-icons.svg#icon-x`，否则用 `/icons/x.svg#icon-x`——**一个图标一个文件，用到哪个才请求哪个（约 500B），不存在全量 sprite**。两条路径的 `<symbol>` 标记完全一致，渲染效果与 `currentColor` 继承不受影响。
- 书签表：真实图标、分类筛选、标签列、状态列；状态徽章可点击重新检测。
- 链接检测：新增站点保存后、修改保存后各自动检测一次（都在 `context.executionCtx.waitUntil()` 里跑，不阻塞保存响应）；后台行内点状态徽章单站检测、顶部「检测链接」批量检测（只检当前页）。结果只回写 `sites.link_status` 与 `updated_at`，不保留检测历史。**没有 Cron、没有 scheduled handler、没有定时任务**：`wrangler.jsonc` 不配 `triggers`，`worker/index.ts` 直接 `export default app`，`runScheduledChecks()` / `staleSites()` / `CRON_LINK_LIMIT` 已删除。**保存时的这一次检测要保留**，用户要的只是不要定时检测，别把 `waitUntil` 当定时任务删掉。
- 书签表分页：表格下方分页器（统计 + 每页条数 + 跳转输入 + 首页/上一页/页码/下一页/末页）。**每页条数：书签默认 18、标签默认 25，可选 5/10/15/18/20/25/全部，也可选“自定义…”填 1–500，选择写入 localStorage（`inav.admin.pageSize.sites` / `.tags`）**；每页条数 0 表示“全部”，此时不分页。搜索、分类筛选、每页条数变化时回到第 1 页。**书签行不可拖拽**（`siteRowHtml` 无 `draggable`、无拖拽手柄列），排序固定为添加顺序。
- 标签表分页：与书签表共用同一套分页器与每页条数规则（默认 25），搜索/排序变化回到第 1 页；表头全选框只作用于当前页。
- 后台品牌名跟随设置站点名。
- 书签**一律前台可见、一律开放详情页**：没有「显示/隐藏」「启用详情页」开关，也没有对应表单字段（`sites.is_visible` / `sites.detail_enabled` 已随 0014 删除）。
- 不引入 React、组件库或调试登录。

### 前台

- 移动端顶栏常驻，左上角 `.top-menu` 打开抽屉（导航 + 分类，仅首页有分类）；**不要加回右下角悬浮分类按钮**。
- 页脚版权居中，不显示站点数/浏览量；独立页面链接右对齐。
- AI 生成的简介在卡片和详情页都必须标注「AI 生成」，且该标签固定排标签第一位。
- **AI 简介是异步任务**：`POST/PUT /api/admin/sites` 在简介留空且 AI 可用时，只把 `ai_pending = 1` 写进库并立即返回（实测响应 ~140ms），生成交给 `ctx.waitUntil()`（Cloudflare 限制：响应返回后 30s，所以单次 AI 请求超时设 22s）。后台书签行在**站点名后面**显示状态胶囊：生成中=黄色「AI 生成中」（脉冲动画）、失败=红色「AI 生成失败 · 重试」、已生成=蓝色「AI 生成」（`ai_generated=1`）。前端每 3s 轮询 `GET /api/admin/sites/:id`，结束即刷新；失败时点击红色胶囊走 `POST /api/admin/sites/:id/generate-description {async:true}` 重新排队（force 覆盖旧简介）。`ai_pending` 超过 5 分钟视为中断，列表改显示红色「AI 生成中断 · 重试」，避免一直转圈。**不要再把生成改回同步阻塞保存。**
- **AI 供应商**（`shared/ai.ts` 的 `AI_PROVIDER_PRESETS`，worker 与后台共用）：Pollinations / DeepSeek / qwen（通义千问，dashscope compatible-mode）/ volcengine（火山方舟 ark）/ OpenAI / Gemini / custom（任意 OpenAI 兼容）。默认地址、默认模型、密钥环境变量都写在预设里；密钥按预设顺序回退到通用 `AI_API_KEY`。新增供应商只改这一个文件 + `AiProvider` 联合类型。
- **提示词模板**：设置项 `ai_prompt`（默认值见 `shared/ai.ts` 的 `DEFAULT_AI_PROMPT`），变量 `{siteName} {name} {url} {category} {tags} {description}`，由 `renderAiPrompt()` 逐行渲染，**引用了空变量的整行会被丢弃**。自定义接口的密钥存 `settings.ai_api_key`（仅 custom 使用），`GET/PUT /api/admin/settings` 一律脱敏为 `""`，只回 `aiApiKeySet`；接口地址走 `normalizeUrl()`，内网/本机地址会被拒（防 SSRF），custom 必须同时有地址和模型才能保存。
- 首页“标签”栏数据契约：`GET /api/nav` 返回 `NavTag { name, count }[]`，**按次数降序、同次数按 `localeCompare(zh-CN)` 升序**，前端渲染成 `名称(次数)`（英文半角括号，次数为 `.tag-count` 灰色小字）。改 `NavPayload.tags` 结构时必须同步 `src/public/main.ts` 的 `tagLinks`、`shared/types.ts` 与 `worker/public.ts`。折叠逻辑见下方「前台实现细节」。

### 前台实现细节（改样式前先看这里）

**布局与断点**

- 容器：顶栏 `.wrap` 是 `min(1220px, 100% - 32px)`；详情页 `.detail-wrap`、独立页 `.page-wrap` 都是 `max-width: 1220px`；首页 `.home-wrap` 是 `min(1440px, 100%)`，≤1439px 收到 `min(1220px, 100% - 32px)`。
- 首页 `.layout` 是 `215px | minmax(0,1fr) | 215px` 三栏，左右栏各自 `position: sticky`；**≤1439px 变两栏并 `display:none` 右栏**，≤900px 变单栏。
- 断点共四个：1439（右栏消失）、900（导航与侧栏收起、抽屉出现）、700（顶栏单行 56px、导航链接进抽屉）、420。每档都要在 390 / 360 宽度实测。
- 顶栏常驻：`.top { position: sticky; top: 0; z-index: 20 }`；抽屉 `.drawer` z-index 30、遮罩 `.sidebar-scrim` 25，层级顺序不能反。
- 联动尺寸：`html { scroll-padding-top: 68px }`，**≤700px 改 66px**（顶栏变单行 56px）；`.sidebar` / `.right-rail` 为 `top: 69px; max-height: calc(100vh - 85px)`。改顶栏高度必须同步这几处，否则锚点跳转会被顶栏盖住。

**移动端抽屉（≤900px）**

- 抽屉由 `shell()` 每页渲染：`renderDrawer(showCategories)`，`showCategories = location.pathname === "/"`——独立页面（`/site/*`、`/page/*`、`/about`）不显示分类，只留导航。
- 结构：`.drawer-head`（站点名 + 关闭）→ `导航` 胶囊区 → `分类`（与 `.sidebar` 共用 `renderCategoryList()`）。
- 桌面顶栏导航限 6 个页面（`navLinks(6)`），抽屉里是全量（`navLinks()`）。
- 开合由 `setDrawer(open)` 统一维护 `body.cats-open` 与按钮 `aria-expanded`；`navigate()`、popstate、Esc 都会关闭。
- `.drawer-link` 必须 `inline-block + max-width:100% + ellipsis + title`，容器 `flex-wrap`、`.drawer-body{overflow-y:auto}`，否则长页面名撑破抽屉。
- 抽屉 `position: fixed`、宽 272px（`max-width: 84vw`）、`translateX(-101%)` 隐藏，`body.cats-open` 时滑入；遮罩 `.sidebar-scrim` 是 `inset: 0` + `rgba(0,0,0,.35)`。
- 左上角 `.top-menu`：30×30、无边框、3px 圆角、透明底、`color: var(--muted)`，尺寸与右侧 `.theme-toggle` 对齐；默认 `display: none`，≤900px 才显示。不要再引入悬浮按钮。

**详情页**

- 桌面 `.detail-top` 是 `display: flex; flex-wrap: wrap`，`.detail-desc`（order 1）与 `.detail-tags`（order 2）设 `flex: 1 0 100%`，通栏左对齐到 `.detail-wrap`；不要塞回 `.detail-head`，否则左侧会留白。
- 移动端 ≤700px 切 grid：`grid-template-columns: auto minmax(0,1fr)`，`.detail-head` / `.detail-title-row` 设 `display: contents` 把容器拍平；`.site-icon.lg` 用 `grid-column: 1; grid-row: 1 / span 2`（**不能 span 3**，会压到徽标行）；之后逐行写死：标题 `2/1`、网址 `2/2`、徽标 `3`、简介 `4`、标签 `5`、按钮 `6`，后四项都是 `grid-column: 1 / -1`。
- 移动端顺序：标题 → 网址 → 徽标 → 简介 → 标签 → 操作按钮。`.detail-domain` 要 `justify-self: start`，否则整列变成可点区域。
- `detailBadge(icon, title, full, mini)`：一个徽标两套文案，≤700px 切 mini。桌面「N 次跳转 / 该页被浏览 N 次 / 收录于 日期」，移动「跳转 N / 浏览 N / 收录 日期」；字号不变，靠删字保证单行。
- 「AI 生成」标签必须放在简介 `<p class="detail-desc">` 内部末尾（`.detail-ai { margin-left: 5px; vertical-align: 1.5px }`），不单独占行。

**卡片与标签栏**

- 简介固定两行截断，`title` 提供原生提示；卡片 hover 浅蓝底 + 边线高亮。
- 卡片标签全量渲染、不出现 “+N”；与「查看详情」同行，实测装不下就往返轮播：`TAG_SCROLL_SPEED = 34.5`（px/s），位移 < 31px 时按 0.9s 保底；触屏可横滑；字体加载与 resize 后重新判定。
- 「查看详情」新标签打开，且**不能带 `data-link`**——带了会被 SPA 路由截成同标签跳转。
- `.tags-bar` 全量渲染：服务端按使用次数降序，同次数按 `localeCompare(zh-CN)` 升序；`TAG_BAR_ROWS = 3`，超过 3 行由 `setupTagsBar()` 实测换行折叠：按钮插在第 3 行末尾（放不下就往前挪一个标签），折叠时文案「展开剩余 N 个」，展开后变「收起」并移到最后；不超过 3 行时按钮隐藏（默认文案「展开全部」）。

**排序控件**

- `SortMode = manual | name | jumps`，界面上对应「时间 / 名称 / 跳转」，`manual` 即按 `sites.id`（添加顺序）。
- 默认方向由 `defaultSortDir()` 决定：`name` 升序，`manual` 与 `jumps` 降序；点当前按钮反转，点其他按钮回到该维度默认方向。
- URL 用 `?sort=name|jumps`（manual 是默认值，不写）+ `?dir=asc|desc`（等于默认方向时不写），解析在 `parseSort()` / `parseSortDir()`；排序主键相同时用 `sites.id` 兜底保证切换稳定。
- 每个按钮都渲染 `.sort-dir` 三角（▲ 升序 / ▼ 降序），当前项 `opacity: 1`、其余 `0.45`，`title` 与 `aria-pressed` 同步。
- 左侧「排序」是纯灰字（`--faint`）+ `border-right` 竖线，不加底色（试过浅灰底，视觉过重被否）；≤700px 去掉竖线、`::after` 补「：」，变成「排序：」。

**其它**

- 右栏是多个独立白卡片（`.rail-section`），≤1439px 整块 `display: none`，不做折叠。
- 详情页截图链路：手填地址 → mShots（`s0.wp.com/mshots/v1/...?w=1200&h=675`）→ `image.thum.io` → `.shot-fallback` 占位（文案「截图暂不可用」）。
- 站点图标：手填地址 → `t3.gstatic.cn/faviconV2` → 首字母。
- 标题字号：`.page-title` 基础 22px；`.page-wrap .page-title`（独立页）27px，≤700px 24px，≤420px 25px（`.page-title` 与 `.page-wrap .page-title` 两条同时写 25px）。CSS 注释里写的「28px / 22px」与实际值不一致，以实际值为准。媒体查询里必须同时写两条选择器，否则会被 `.page-wrap .page-title`（0,2,0）压住。

## 6. 数据库

- categories：多级分类、icon、parent_id、sort_order。
- sites：分类、名称、slug、url、描述、图标/截图、tags JSON、detail_content、views（详情页浏览量）、jumps（外链跳转数）、ai_generated、ai_pending、ai_error、link_status、link_checked_at、时间戳。没有 clicks / sort_order / is_visible / detail_enabled：所有站点都可见、都有详情页、顺序按 id。ai_pending=1 表示后台 AI 任务在跑，ai_error 是上次失败原因。
- pages：title、slug、excerpt、content、show_in_nav、is_published、sort_order、views（被打开次数）、时间戳。内置两行 `home` / `about` 由迁移写入，`show_in_nav=0`（首页不计入页面菜单、关于页在前台是固定链接）。
- comments：site_id/page_id 二选一、author、email、website、content、status、ip_hash、ip、ip_location、device、browser、os、created_at、updated_at；没有 user_agent。
- daily_stats：**每日总量**，主键 `day`（北京时间 YYYY-MM-DD），只有 `views`（当天所有页面被打开的总次数）与 `jumps`（当天所有跳转的总次数）两列。一天一行，跨天写新行，没有任何重置逻辑；今日 = `SELECT views, jumps FROM daily_stats WHERE day = todayKey()`。
- settings：站点/SEO/评论/AI/管理员配置；AI 相关键为 ai_provider / ai_model / ai_base_url / ai_api_key / ai_prompt（ai_prompt 空值时回退 `DEFAULT_AI_PROMPT`）。**没有 about_content**：关于页正文在 pages 表里。
- 标签没有独立表：后台“标签”tab 由 sites.tags 实时聚合（方案 A）；重命名/删除/合并都是遍历 sites 改写 tags JSON，再经 `parseTags()` 去重截断。

迁移：**只有 `migrations/0001_init.sql` 一个全量初始化文件**，没有增量补丁。改结构就直接改这个文件，然后 `npm run db:reset` 重建本地库（脚本 `scripts/reset-local-db.mjs`：删掉本地 D1 数据文件再应用迁移），远端重新部署时同样按新库建。历史上的 0002–0016 已合并进 0001，不要再新增 `0002_xxx.sql` 这类补丁。

所有站点都可见、都有 `/site/<slug>` 详情页、都进 sitemap。删列时必须同步清掉 public/admin 里所有 `is_visible = 1` / `detail_enabled = 1` 条件和 `sort_order` 排序——这类裸 SQL 字符串 tsc 查不出来，只能 grep。

## 7. API

公开：

- GET /api/health
- GET /api/nav
- GET /api/sites/:slug
- GET /api/sites/:slug/comments
- GET /api/pages/:slug（只读，不累加计数）
- GET /api/pages/:slug/comments
- GET /api/recent-comments?limit=4
- GET /api/captcha
- POST /api/sites/:slug/comments
- POST /api/pages/:slug/comments
- POST /api/sites/:id/jump
- POST /api/views（body `{ kind: "site" | "page", id }`，写 sites.views|pages.views 与 daily_stats.views）
- GET /go/:id（jumps+1）
- GET /sitemap.xml

后台（需 OAuth 会话）：

- GET/POST /api/admin/sites；GET/PUT/DELETE /api/admin/sites/:id
- POST /api/admin/sites/:id/generate-description
- POST /api/admin/sites/:id/check
- POST /api/admin/check-all
- GET/POST /api/admin/categories；PUT/DELETE /api/admin/categories/:id
- GET /api/admin/tags；POST /api/admin/tags/rename（body: from/to/merge，撞名 409）；POST /api/admin/tags/bulk-rename（body: names[]/to/merge）；POST /api/admin/tags/remove（body: names[]）
- GET/POST /api/admin/pages；GET/PUT/DELETE /api/admin/pages/:id
- GET/PATCH/DELETE /api/admin/comments
- GET/PUT /api/admin/settings
- POST /api/admin/reorder，type: categories|pages（sites 已移除）
- 无 /api/admin/overview

## 8. 安全约束

- 仅 GitHub OAuth；没有 DEV_LOGIN / 本地快捷登录。
- SESSION_SECRET 至少 16 字符，缺失时认证抛错。
- 管理写请求校验 Origin（SITE_URL 或当前 origin）。
- Cookie：HttpOnly、SameSite=Lax、HTTPS Secure。
- SQL 全部参数化；用户内容转义；Markdown 先转义 HTML。
- CSP：script-src 'self'；主题脚本 public/theme-init.js，不要重新加 inline script。
- public/_headers 与 Worker admin 响应设置 CSP/HSTS/XFO/COOP/Permissions-Policy。
- 站点 URL 限制 http(s)，拒绝本地/内网。
- 评论邮箱不进入公开返回。

## 9. 验证状态

- npm run build 通过（worker + client typecheck + Vite）。
- npm run test:api 公开面通过（9 项）。
- 已验证后台书签 CRUD、分类/页面编辑、标签编辑器、Markdown 预览、图标弹窗、分类筛选、拖拽排序、状态检测、设置保存。
- npm audit --omit=dev：0 漏洞。

## 10. 不要重新引入

- React、React Router、lucide-react。
- dev-login 或 DEV_LOGIN/ENVIRONMENT 配置。
- sites.clicks 或后台点击统计。
- 表单里的排序值输入。
- 概览页。
- 把站点 views 改成详情页 PV。
- 把邮箱/个人网址公开。
- HTML inline script（违反 CSP）。
- 在仓库提交 .dev.vars、.wrangler、dist、node_modules、密钥。

## 11. 已知边界

- 演示数据只在 scripts/seed.sql；实际 D1 数据不在源码包内。
- `wrangler.jsonc` 只有 `database_name: "inav"`，没有 `database_id`；云上必须存在同名 D1，否则部署报 `Couldn't find a D1 DB named 'inav'`。
- 截图依赖 mShots/image.thum.io，可能失败或慢。
- 站点图标使用 Google gstatic CN 或手填 URL，失败显示首字母。
- AI 简介依赖外部服务，可能限流；异步任务受 `waitUntil` 30s 限制，超时/失败会落到 `ai_error`，可点「重试」重新排队。
- scripts/smoke-api.mjs 只覆盖公开面；后台自动化需要 OAuth 会话。
- 图标精灵来自 lucide-static（devDependency），许可证在 public/category-icons.LICENSE.txt；生成脚本 scripts/build-icon-sprite.mjs 会校验分组里不存在的图标名并退出非 0。
- `public/icons/`（精选之外的 1952 个单图标）**随仓库提交，不要加回 .gitignore**：Cloudflare Workers Builds 每次都是干净 clone，产物不入库就得每次重新生成（约 5s），而且构建命令一旦被改成 `vite build` 就会静默缺图标。
- 图标产物与 `src/lib/lucide-groups.json` 的同步由 `npm run icons:check` 兜住（`npm run build` 已包含，只读、毫秒级）。改了配置却没跑 `icons:build` 会让构建直接失败，而不是上线后才发现图标空白——注意缺图标时 SPA 回退会让 `/icons/x.svg` 返回 200 + `text/html`，控制台连 404 都没有。
