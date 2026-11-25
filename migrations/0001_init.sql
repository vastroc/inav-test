-- 锦囊书签 · 全量 schema
--
-- 单文件初始化迁移：新库直接建出最终结构，不再用一串补丁迁移往上叠。
-- 以后改结构就直接改本文件；已经建好的库用 `npm run db:reset` 重建（远端重新部署时同理）。
--
-- 计数口径：
--   sites.views = 该站点详情页被打开的次数
--   sites.jumps = 该站点外链被点开的次数
--   pages.views = 该独立页面被打开的次数
--   daily_stats = 当天所有页面被打开的总次数 + 当天所有跳转的总次数（一天一行）
--
-- 首页（slug=home）与关于页（slug=about）也是 pages 里的普通行：
-- 首页那行只用来存访问计数，正文由前端渲染；关于页的正文就是它的 content，在后台「页面」里编辑。

PRAGMA foreign_keys = ON;

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT 'folder',
  parent_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_categories_parent ON categories(parent_id, sort_order, id);
CREATE INDEX idx_categories_sort ON categories(sort_order, id);

CREATE TABLE sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon_url TEXT NOT NULL DEFAULT '',
  screenshot_url TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  detail_content TEXT NOT NULL DEFAULT '',
  views INTEGER NOT NULL DEFAULT 0,
  jumps INTEGER NOT NULL DEFAULT 0,
  ai_generated INTEGER NOT NULL DEFAULT 0 CHECK (ai_generated IN (0, 1)),
  ai_pending INTEGER NOT NULL DEFAULT 0,
  ai_error TEXT,
  link_status TEXT NOT NULL DEFAULT 'unknown' CHECK (link_status IN ('unknown', 'alive', 'warn', 'dead')),
  link_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_sites_category ON sites(category_id, id);
CREATE INDEX idx_sites_status ON sites(link_status, link_checked_at);

CREATE TABLE pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  excerpt TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  show_in_nav INTEGER NOT NULL DEFAULT 1 CHECK (show_in_nav IN (0, 1)),
  is_published INTEGER NOT NULL DEFAULT 1 CHECK (is_published IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_pages_public ON pages(is_published, sort_order, id);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  page_id INTEGER REFERENCES pages(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'spam')),
  ip_hash TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  ip_location TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT '',
  browser TEXT NOT NULL DEFAULT '',
  os TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((site_id IS NOT NULL AND page_id IS NULL) OR (site_id IS NULL AND page_id IS NOT NULL))
);

CREATE INDEX idx_comments_site ON comments(site_id, status, created_at DESC);
CREATE INDEX idx_comments_page ON comments(page_id, status, created_at DESC);
CREATE INDEX idx_comments_status ON comments(status, created_at DESC);
CREATE INDEX idx_comments_rate ON comments(ip_hash, created_at);

-- 每日总量：一天一行，只记「当天所有页面被打开多少次」和「当天跳转多少次」
CREATE TABLE daily_stats (
  day TEXT PRIMARY KEY,
  views INTEGER NOT NULL DEFAULT 0,
  jumps INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO settings (key, value) VALUES
  ('site_name', '锦囊书签'),
  ('site_tagline', '把好网站，装进锦囊'),
  ('site_description', '一份克制、清晰、持续生长的网址收藏。'),
  ('footer_text', '锦囊书签 · 藏万千好物，纳方寸锦囊。'),
  ('seo_keywords', '导航站,网址导航,网址收藏,极简导航,工具导航'),
  ('github_admins', ''),
  ('ai_provider', 'pollinations'),
  ('ai_model', 'openai'),
  ('ai_base_url', ''),
  ('comments_enabled', '1'),
  ('comment_moderation', '1'),
  ('banned_words', '博彩,赌场,代开发票,办证,加微信,裸聊,色情,成人视频,刷单,返利,USDT,telegram群,推广链接');

-- 内置页面。show_in_nav = 0：关于页在导航里是固定链接、首页本来就不是独立页面，都不进「页面」菜单。
INSERT INTO pages (title, slug, excerpt, content, show_in_nav, is_published, sort_order) VALUES
  ('首页', 'home', '', '', 0, 1, 0);

INSERT INTO pages (title, slug, excerpt, content, show_in_nav, is_published, sort_order) VALUES
  ('关于', 'about', '关于这个站点', '# 关于锦囊书签

锦囊书签是一份公开的网址收藏，也是一个安静的上网入口。

我们相信，好的导航不应该制造噪音。它只需要在你想去某个地方时，快速、准确地把你送到。因此这里没有弹窗、没有信息流，只有经过整理的工具、资料与灵感来源。

## 收录原则

- 以长期有用的网站为主，尽量避开短期营销页。
- 每个站点都有简洁说明与标签，方便快速判断。
- 站点介绍与评论仅代表个人观点，不构成任何推荐或担保。

## 关于评论

每个站点都有独立讨论区。评论需要完成人机验证，并遵守基本的友善交流原则。广告、攻击性内容与垃圾信息会被移除。

## 保持联系

如果你发现链接失效、描述有误，欢迎在对应站点的详情页留言。这个小小的索引会持续维护、慢慢生长。', 0, 1, 10);
