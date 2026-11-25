# 部署到 Cloudflare

从零到上线的完整步骤。全部做完大约 15 分钟，之后每次改代码只需要 `git push`。

目标架构：

| 组件 | 说明 |
| --- | --- |
| Worker | 运行 `worker/index.ts`，同时提供 API、`/admin` 和静态资源 |
| D1 | 数据库，binding 名 `DB`，库名 `inav` |
| Static Assets | `./dist`，由 `npm run build` 生成 |

需要：Cloudflare 账号、GitHub 账号、本机 Node.js **22.12+** 和 Git。不需要服务器、Docker 或信用卡。

> 本文命令都在项目根目录执行。Windows 用 Git Bash / PowerShell 均可。
>
> 不想碰命令行：README 顶部的 **Deploy to Cloudflare** 按钮会自动建库、建 Worker、跑迁移，等价于本文全部步骤。下面是不用按钮时的手工流程。

---

## 1. 本地确认能跑

```bash
npm install
npm run build      # 类型检查 + 图标校验 + 打包，必须 0 error
```

想先在本地看效果：

```bash
npm run setup      # 建本地 D1 + 演示数据
npm run dev        # http://127.0.0.1:8787
```

`npm run build` 过不了就别往下走，线上构建会用同一条命令，必然一起失败。

---

## 2. 推到 GitHub

先自检，仓库里不能有 `.dev.vars`、`.wrangler/`、`dist/`、`node_modules/`（`.gitignore` 已覆盖）：

```bash
git status --short
git ls-files | grep -i "dev.vars"    # 应无输出
```

创建仓库：打开 <https://github.com/new>，填仓库名，**不要**勾选 README / .gitignore / License（本地已有文件，会冲突），公开或私有都行。

推送：

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<你的账号>/<仓库名>.git
git push -u origin main
```

- 报 `Please tell me who you are`：先 `git config --global user.name / user.email`。
- 要求输入密码：GitHub 已停用账号密码，改用 Personal Access Token（Fine-grained，给该仓库 Contents: Read and write）或 SSH。
- 如果误提交了密钥：删文件再提交没用，历史里仍在，必须重置密钥。

---

## 3. 登录 Cloudflare 并创建 D1

```bash
npx wrangler login
npx wrangler d1 create inav
```

- 库名必须是 `inav`，和 `wrangler.jsonc` 里的 `database_name` 一致。**不需要**手动填 `database_id`，wrangler 会按名字解析。
- 想换库名：先 `npx wrangler d1 create 你的名字`，再把 `wrangler.jsonc` 的 `database_name` 改成同一个名字，然后提交。
- 核对：`npx wrangler d1 list` 能看到 `inav`。

应用表结构：

```bash
npm run db:migrate:remote
```

等价于 `npx wrangler d1 migrations apply DB --remote`。迁移只有 `migrations/0001_init.sql` 一个全量文件，重复执行会跳过，安全（`npm run deploy` 里也会自动跑一次，这里先跑是为了提前暴露问题）。

> **不要**在正式站跑 `npm run db:seed:remote`：那是 52 条演示站点，会混进你的真实数据。

---

## 4. 首次部署

```bash
npm run deploy
```

内部是 `npm run build && npm run db:migrate:remote && wrangler deploy`，迁移重复执行会跳过，不会出问题。成功后会打印访问地址，形如：

```text
https://inav.<你的子域>.workers.dev
```

这时前台已经可用；`/admin` 会提示 OAuth 未配置，属正常。先确认 `https://你的地址/api/health` 返回 JSON。

---

## 5. 设置 Secrets

生成一个 `SESSION_SECRET`：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

逐条执行，命令会提示粘贴值（输入不回显）：

```bash
npx wrangler secret put SESSION_SECRET
npx wrangler secret put SITE_URL
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put ADMIN_GITHUB_LOGINS
```

| Secret | 值 |
| --- | --- |
| `SESSION_SECRET` | 上面生成的随机串，至少 16 字符 |
| `SITE_URL` | 站点公开地址，如 `https://inav.xxx.workers.dev`，不带结尾斜杠 |
| `GITHUB_CLIENT_ID` | GitHub OAuth App 的 Client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App 的 Client Secret |
| `ADMIN_GITHUB_LOGINS` | 管理员 GitHub 用户名，多个用逗号分隔 |

要点：

- `SITE_URL` **必须和浏览器地址栏完全一致**（协议、域名、有无 `www` 都算不同），否则后台保存会 403，OAuth 也会失败。绑定自定义域名后记得改。
- Secret 由 Cloudflare 侧管理，不参与构建。写入后如果后台仍提示未配置，重新部署一次（`npx wrangler deploy`）再刷新。
- AI 简介可选，不配 Key 也能用免费的 Pollinations；要指定供应商再设 `DASHSCOPE_API_KEY` / `ARK_API_KEY` / `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`（或通用 `AI_API_KEY`），模型和接口地址在后台「设置 → AI 简介」里选。

查看已有 Secret 名单：`npx wrangler secret list`（只列名字，不显示值）。

---

## 6. 创建 GitHub OAuth App

打开 <https://github.com/settings/developers> → **New OAuth App**：

| 字段 | 值 |
| --- | --- |
| Application name | 随便填，如 `iNav` |
| Homepage URL | `https://你的地址` |
| Authorization callback URL | `https://你的地址/api/auth/github/callback` |

创建后复制 Client ID，再点 **Generate a new client secret** 生成 Secret，把两者写进第 5 步的两个 Secret：

```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
```

然后访问 `https://你的地址/admin`，用 `ADMIN_GITHUB_LOGINS` 里的账号登录，保存一条书签验证写权限。

---

## 7. 绑定自定义域名（可选，推荐）

1. 域名需已托管在同一个 Cloudflare 账号。
2. Dashboard → Workers & Pages → `inav` → Settings → Domains & Routes → Add → Custom domain，填域名，等证书生效。
3. 更新 `SITE_URL`：`npx wrangler secret put SITE_URL`。
4. 回到 GitHub OAuth App，把 Homepage URL 和 Callback URL 都改成新域名。
5. 打开新域名确认首页、`/admin`、`/sitemap.xml` 都正常。`SITE_URL` 是请求时读取的，改完不用重新部署；`*.workers.dev` 可以继续访问，不用关。

---

## 8. 开启 push 自动部署（推荐）

完成第 3～6 步后，日常只想要 `git push` 上线：

1. Dashboard → Workers & Pages → Create application → **Workers** → **Import a repository**。
   如果已经存在同名 Worker（第 4 步创建的），改用该 Worker 的 Settings → Build → **Connect to Git**。
2. 授权 GitHub，选中仓库和 `main` 分支。
3. 填构建配置：

| 配置项 | 值 |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npm run deploy` |
| Root directory | `/`（留空） |
| 环境变量 | `NODE_VERSION=22` |

`npm run deploy` 自带构建、远程迁移和 `wrangler deploy`，不会漏步；Workers Builds 的 Build 阶段已经构建过，这里会再构建一次，多花几秒但更省心。

4. 保存并触发第一次构建。日志里依次出现类型检查、`vite build`、迁移、`Uploaded inav` 即成功。

之后：

```bash
git add .
git commit -m "fix: xxx"
git push
```

1～2 分钟自动上线，控制台 Deployments 可看日志、重试、回滚到任一历史版本。

注意事项：

- 同一时间只能启用一种自动部署，Workers Builds 和 GitHub Actions **不要同时开**，否则一次 push 部署两次。
- Secrets 不在构建里，仍在 Cloudflare 侧管理；改 Secret 不影响构建，必要时重新部署一次让它生效。
- 默认只有 `main` 部署生产；需要预览分支可在 Workers Builds 设置里开 preview URL。

---

## 9. 备选：GitHub Actions

不想在 Cloudflare 里授权 GitHub 时用仓库自带的 `.github/workflows/deploy.yml`。没配 `CLOUDFLARE_API_TOKEN` 时这个工作流只会打印一行提示并跳过，不会让 push 变红。

1. Dashboard → My Profile → API Tokens → Create Token，模板 **Edit Cloudflare Workers**，权限里补 **D1 → Edit**；Account Resources 选自己的账号。
2. 复制 Token，并记下 Account ID（Workers 页面右侧可取）。
3. GitHub 仓库 → Settings → Secrets and variables → Actions，添加：

| 名称 | 值 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 上一步的 Token |
| `CLOUDFLARE_ACCOUNT_ID` | 你的 Account ID |

4. push 到 `main`，或在 Actions 页面手动 Run workflow。流程：`npm ci` → `npm run build` → D1 远程迁移 → `wrangler deploy`。

Token 缺 D1 权限时报 `Authentication error` 或 `D1 migration failed`。

---

## 10. 验证清单

- [ ] `https://你的地址/api/health` 返回 JSON
- [ ] 首页样式、图标正常
- [ ] `/admin` 显示 GitHub 登录，登录后能保存书签（验证 `SITE_URL`、Cookie、回调地址）
- [ ] 打开一个站点详情页，浏览量 +1；点外链，跳转数 +1
- [ ] `/sitemap.xml` 里的域名是正式域名
- [ ] 后台「检测链接」能返回状态
- [ ] Cloudflare 的 Cron Triggers 为空（本项目没有定时任务）

---

## 11. 日常运维

**日志**

```bash
npx wrangler tail inav            # 实时日志
```

**备份**

```bash
npx wrangler d1 export inav --remote --output backup.sql
```

**回滚代码**

Workers & Pages → `inav` → Deployments → 选上一个版本 → Rollback。

**改表结构（重要）**

项目只保留 `migrations/0001_init.sql` 一个全量文件。线上库已经应用过它，修改文件内容**不会**在下次部署时重放（迁移记录里已标记完成）。线上改结构要手动执行：

```bash
npx wrangler d1 execute DB --remote --command "ALTER TABLE sites ADD COLUMN xxx TEXT"
```

改完记得同步更新 `0001_init.sql`，让新部署的库拿到同样的结构；本地用 `npm run db:reset` 重建验证。

**恢复数据**：先把 `backup.sql` 导入一个空库，再确认结构和当前代码一致，不要直接往线上跑。

---

## 12. 常见问题

**`Couldn't find a D1 DB named 'inav'`**
库没建，或建在了另一个 Cloudflare 账号。`npx wrangler d1 list` 核对；换过库名就同步改 `wrangler.jsonc` 的 `database_name`。

**登录后立刻掉线 / `SESSION_SECRET must be at least 16 characters`**
Secret 没设或太短。重设 `SESSION_SECRET` 并重新部署一次。

**后台保存返回 403**
浏览器地址与 `SITE_URL` 不一致（`http`/`https`、`www`、结尾斜杠都算不同）。改成实际 origin。

**OAuth 报 `redirect_uri_mismatch`**
Callback 必须是 `https://你的地址/api/auth/github/callback`，且与 `SITE_URL` 同域。

**页面空白、静态资源 404、`assets directory not found`**
`dist` 是空的。本地用 `npm run deploy`（自带构建）；Workers Builds 的 Build command 必须是 `npm run build`。

**图标不显示，控制台也没有 404**
缺图标时 SPA 回退会让 `/icons/x.svg` 返回 `200 + text/html`。说明构建产物和 `src/lib/lucide-groups.json` 不同步：跑 `npm run icons:build` 并提交 `public/icons/`、`public/category-icons.svg`、`public/lucide-names.json`。

**线上 500，本地正常**
先 `npx wrangler tail inav`，多数是缺 Secret 或 D1 没迁移。

**迁移报 `duplicate column` / 表已存在**
手工改过线上库。用 `npx wrangler d1 migrations list DB --remote` 看状态，不要删记录硬跑，按第 11 节手工对齐结构。

---

## 13. 免费额度参考

| 资源 | 免费额度（以官网为准） |
| --- | --- |
| Workers 请求 | 100,000 次/天 |
| Workers CPU | 10 ms/请求（免费计划） |
| D1 存储 | 5 GB |
| D1 行读取 | 5,000,000 行/天 |
| D1 行写入 | 100,000 行/天 |
| 静态资源 | 不限请求，计入 Workers 请求 |

个人导航站的实际流量远低于这些上限；详情页截图由访客浏览器直接请求第三方服务，不占 Worker 额度。
