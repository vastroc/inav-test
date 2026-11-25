-- Demo content for local evaluation. Safe to run once after migrations.
-- Existing rows are preserved (INSERT OR IGNORE).

INSERT OR IGNORE INTO categories (name, slug, description, icon, parent_id, sort_order) VALUES ('开发技术', 'development', '写代码、查文档、搭服务。', 'code', NULL, 10);
INSERT OR IGNORE INTO categories (name, slug, description, icon, parent_id, sort_order) VALUES ('前端开发', 'frontend', '浏览器里的界面与交互。', 'layout', (SELECT id FROM categories WHERE slug='development'), 10);
INSERT OR IGNORE INTO categories (name, slug, description, icon, parent_id, sort_order) VALUES ('后端与云', 'backend', '服务、部署与基础设施。', 'server', (SELECT id FROM categories WHERE slug='development'), 20);
INSERT OR IGNORE INTO categories (name, slug, description, icon, parent_id, sort_order) VALUES ('AI 工具', 'ai', '把模型变成日常生产力。', 'sparkles', (SELECT id FROM categories WHERE slug='development'), 30);
INSERT OR IGNORE INTO categories (name, slug, description, icon, parent_id, sort_order) VALUES ('设计灵感', 'design', '好设计值得被反复观看。', 'palette', NULL, 20);
INSERT OR IGNORE INTO categories (name, slug, description, icon, parent_id, sort_order) VALUES ('设计资源', 'design-resources', '工具、作品与素材。', 'pen-tool', (SELECT id FROM categories WHERE slug='design'), 10);
INSERT OR IGNORE INTO categories (name, slug, description, icon, parent_id, sort_order) VALUES ('配色与字体', 'colors-type', '颜色、字形与视觉秩序。', 'type', (SELECT id FROM categories WHERE slug='design'), 20);
INSERT OR IGNORE INTO categories (name, slug, description, icon, parent_id, sort_order) VALUES ('学习成长', 'learning', '长期阅读与持续输入。', 'book-open', NULL, 30);
INSERT OR IGNORE INTO categories (name, slug, description, icon, parent_id, sort_order) VALUES ('文档与社区', 'docs-community', '查资料，也和人交流。', 'library', (SELECT id FROM categories WHERE slug='learning'), 10);
INSERT OR IGNORE INTO categories (name, slug, description, icon, parent_id, sort_order) VALUES ('效率工具', 'productivity', '让重复的事情更轻一点。', 'zap', NULL, 40);
INSERT OR IGNORE INTO categories (name, slug, description, icon, parent_id, sort_order) VALUES ('协作与办公', 'office', '记录、沟通与项目管理。', 'briefcase', (SELECT id FROM categories WHERE slug='productivity'), 10);
INSERT OR IGNORE INTO categories (name, slug, description, icon, parent_id, sort_order) VALUES ('生活服务', 'life', '工作之外，也认真生活。', 'coffee', NULL, 50);
INSERT OR IGNORE INTO categories (name, slug, description, icon, parent_id, sort_order) VALUES ('影音娱乐', 'media', '看点什么，听点什么。', 'play', (SELECT id FROM categories WHERE slug='life'), 10);
INSERT OR IGNORE INTO categories (name, slug, description, icon, parent_id, sort_order) VALUES ('资讯阅读', 'news', '保持对世界的感知。', 'newspaper', (SELECT id FROM categories WHERE slug='life'), 20);

INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='frontend'), 'GitHub', 'github', 'https://github.com', '全球最大的代码托管与协作平台，开源项目、版本管理和团队开发都在这里发生。', '', '["开发","代码托管","开源"]', '## 为什么收录

GitHub 不只是一个代码托管网站。它同时是开源协作的基础设施、开发者的作品集，以及大量文档与工具的分发入口。很多项目的 README、Issue 与 Releases，往往比官网更接近真实使用情况。

## 适合谁

- 需要管理代码版本的个人开发者与团队。
- 想参与开源项目、提交 Issue 或 PR 的人。
- 正在寻找某个领域成熟实现与参考代码的人。

## 使用建议

1. 用组织与仓库的 Topics 做第一轮筛选。
2. 看项目的最近提交时间、Issue 响应速度与 Release 节奏。
3. 在 Issues 中搜索报错信息，通常比泛泛搜索更快。
4. 关注少量真正维护的项目，而不是无限收藏。

> 收藏不是目的。让一个仓库真正进入你的工作流，才算完成一次发现。', 5812, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='frontend'), 'MDN Web Docs', 'mdn', 'https://developer.mozilla.org', 'Mozilla 维护的 Web 技术文档，HTML、CSS 与 JavaScript 的权威参考。', '', '["文档","Web","前端"]', '', 3021, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='frontend'), 'React', 'react', 'https://react.dev', '用于构建用户界面的 JavaScript 库，组件化与声明式渲染的经典选择。', '', '["前端","框架","React"]', '', 2280, 1, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='frontend'), 'Vue.js', 'vue', 'https://cn.vuejs.org', '渐进式 JavaScript 框架，文档友好，适合从页面增强到完整应用。', '', '["前端","框架","Vue"]', '', 1740, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='frontend'), 'Tailwind CSS', 'tailwind', 'https://tailwindcss.com', '原子化 CSS 框架，用工具类快速搭建一致、可维护的界面。', '', '["CSS","前端","工具"]', '', 1206, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='frontend'), 'Can I use', 'caniuse', 'https://caniuse.com', '查询 HTML、CSS 与 Web API 在各浏览器中的兼容情况。', '', '["兼容性","前端","查询"]', '', 900, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='frontend'), 'CodePen', 'codepen', 'https://codepen.io', '在线前端代码片段编辑与展示社区，适合试验想法和寻找灵感。', '', '["前端","演示","社区"]', '', 812, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='frontend'), 'Stack Overflow', 'stackoverflow', 'https://stackoverflow.com', '全球开发者问答社区，遇到具体技术问题时的高效搜索入口。', '', '["问答","开发","社区"]', '', 2030, 0, 'warn', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='backend'), 'Cloudflare', 'cloudflare', 'https://www.cloudflare.com', '边缘网络与开发者平台，提供 CDN、Workers、D1 与安全防护。', '', '["云服务","CDN","边缘计算"]', '## 一个面向边缘的开发者平台

Cloudflare 从 CDN 与 DNS 起步，现在提供 Workers、Pages、R2、D1、Queues 等一整套运行时与服务。它的特点是把计算放到离用户更近的节点，并且按使用量计费。

## 这个站点为什么用它

锦囊书签部署在 Cloudflare Workers 上，使用 D1 作为 SQLite 数据库。前台静态资源、API、定时任务都在同一个项目中，维护成本很低。

## 适合谁

- 想低成本上线全栈应用的个人开发者。
- 需要全球访问速度与基础安全防护的小型产品。
- 已经熟悉 JavaScript 或 TypeScript 的前端工程师。

## 上手提示

- 先读 Workers 的运行时限制，再决定架构。
- 本地开发使用 Wrangler，可以把 D1 一并跑起来。
- 生产环境记得为 D1 建立迁移流程，不要手工改表。', 1950, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='backend'), 'Vercel', 'vercel', 'https://vercel.com', '面向前端与全栈应用的部署平台，Git 推送即可上线。', '', '["部署","前端","云"]', '', 1120, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='backend'), 'Hono', 'hono', 'https://hono.dev', '轻量、快速的 Web 框架，优先为边缘运行时与 TypeScript 设计。', '', '["框架","边缘计算","TypeScript"]', '', 760, 1, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='backend'), 'Node.js', 'nodejs', 'https://nodejs.org', '基于 V8 的 JavaScript 运行时，服务端工具与 Web 服务的基础设施。', '', '["运行时","JavaScript","后端"]', '', 1360, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='backend'), 'Docker Hub', 'docker-hub', 'https://hub.docker.com', '容器镜像的公共仓库，查找与分发开发环境和基础服务镜像。', '', '["容器","DevOps","镜像"]', '', 1024, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='backend'), 'Supabase', 'supabase', 'https://supabase.com', '开源的 Firebase 替代方案，提供 Postgres、认证、存储与实时订阅。', '', '["数据库","后端","BaaS"]', '', 1288, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='backend'), 'Railway', 'railway', 'https://railway.com', '将应用、数据库与服务快速部署到云端的开发者平台。', '', '["部署","后端","云"]', '', 590, 0, 'unknown', NULL);
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='ai'), 'ChatGPT', 'chatgpt', 'https://chatgpt.com', 'OpenAI 的通用对话助手，用于写作、编程、分析与日常问答。', '', '["AI","对话","效率"]', '## 一个通用型对话助手

ChatGPT 能处理写作、解释概念、生成代码、整理资料等任务。它的价值不在于一次给出完美答案，而在于把模糊的问题快速推进到可验证的下一步。

## 适合的用法

- 把长文档压缩成提纲，再回到原文核对。
- 让模型解释一段陌生代码，并要求指出不确定之处。
- 生成多个方案，再由人做取舍。
- 把重复的文本处理变成固定提示词。

## 使用原则

1. 重要事实必须交叉验证。
2. 不要上传机密、客户数据或未公开代码。
3. 把模型当作助手，而不是最终责任人。
4. 提示词越具体，结果越稳定。

## 延伸

如果你需要长文本处理，可以配合 Claude；需要联网搜索与来源引用，可以试试 Perplexity。', 7040, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='ai'), 'Claude', 'claude', 'https://claude.ai', 'Anthropic 的对话助手，长文本理解与代码协作表现稳定。', '', '["AI","对话","写作"]', '', 4120, 1, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='ai'), 'Gemini', 'gemini', 'https://gemini.google.com', 'Google 的多模态 AI 助手，与搜索和 Workspace 生态衔接紧密。', '', '["AI","多模态","Google"]', '', 2980, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='ai'), 'Hugging Face', 'huggingface', 'https://huggingface.co', '开源模型与数据集的集散地，也是机器学习社区的重要入口。', '', '["AI","开源","模型"]', '', 1840, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='ai'), 'Perplexity', 'perplexity', 'https://www.perplexity.ai', '带来源引用的 AI 搜索，适合快速调研与交叉验证信息。', '', '["AI","搜索","研究"]', '', 1520, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='ai'), 'Cursor', 'cursor', 'https://cursor.com', '内置 AI 能力的代码编辑器，支持跨文件理解与自然语言改写。', '', '["AI","编程","编辑器"]', '', 2230, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='ai'), 'Pollinations', 'pollinations', 'https://pollinations.ai', '面向创作者的开放生成式 AI 接口，文本与图像能力可直接调用。', '', '["AI","生成","API"]', '', 430, 1, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='design-resources'), 'Figma', 'figma', 'https://www.figma.com', '协作式界面设计工具，从线框图到设计系统都在浏览器中完成。', '', '["设计","协作","UI"]', '## 浏览器里的设计工作台

Figma 把界面设计、原型、评论与设计系统放在同一个文件中。多人实时协作和可分享的链接，改变了设计交付的方式。

## 我通常怎么用

- **文件即工作区**：每个产品线一个文件，页面按流程拆分。
- **组件先行**：先建立颜色、文字与基础控件，再画业务页面。
- **评论代替截图**：把讨论留在具体图层旁边。
- **交付前检查**：用 Auto Layout 与变量减少硬编码。

## 适合谁

产品设计师、交互设计师、前端工程师，以及需要参与设计评审的产品经理。

## 注意

Figma 的免费额度适合个人与小团队；团队使用前先确认文件权限与版本管理习惯。', 3890, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='design-resources'), 'Dribbble', 'dribbble', 'https://dribbble.com', '设计师作品与灵感社区，适合观察视觉趋势和细节表达。', '', '["设计","灵感","社区"]', '', 1420, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='design-resources'), 'Behance', 'behance', 'https://www.behance.net', 'Adobe 旗下的创意作品平台，覆盖品牌、插画、产品与空间设计。', '', '["设计","作品集","创意"]', '', 1108, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='design-resources'), 'Awwwards', 'awwwards', 'https://www.awwwards.com', '收录高质量网站设计，关注排版、动效与交互体验。', '', '["网页设计","交互","灵感"]', '', 890, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='design-resources'), 'Godly', 'godly', 'https://godly.website', '精选的网页设计案例库，按风格与行业发现前沿站点。', '', '["网页设计","案例","灵感"]', '', 640, 1, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='design-resources'), 'Muzli', 'muzli', 'https://muz.li', '设计灵感聚合器，把来自多个平台的新鲜作品放进一个信息流。', '', '["设计","聚合","灵感"]', '', 508, 0, 'warn', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='colors-type'), 'Coolors', 'coolors', 'https://coolors.co', '快速生成、调整与导出配色方案的在线工具。', '', '["配色","工具","设计"]', '', 1120, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='colors-type'), 'Google Fonts', 'google-fonts', 'https://fonts.google.com', '免费开源字体库，支持中文与多语言，可直接用于网页。', '', '["字体","Google","资源"]', '', 1380, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='colors-type'), 'Fontshare', 'fontshare', 'https://www.fontshare.com', '免费商用字体平台，提供现代、克制的西文字体选择。', '', '["字体","免费商用","资源"]', '', 566, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='colors-type'), 'Iconify', 'iconify', 'https://iconify.design', '统一的图标聚合接口，汇集多套开源图标集，支持按需使用。', '', '["图标","资源","开发"]', '', 780, 1, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='colors-type'), 'Unsplash', 'unsplash', 'https://unsplash.com', '高质量免费图片库，适合原型、文章配图与视觉参考。', '', '["图片","素材","免费"]', '', 1210, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='docs-community'), '阮一峰的网络日志', 'ruanyifeng', 'https://www.ruanyifeng.com/blog/', '长期更新的技术与人文博客，科技爱好者周刊影响广泛。', '', '["博客","技术","周刊"]', '', 1860, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='docs-community'), 'V2EX', 'v2ex', 'https://www.v2ex.com', '以创意、技术和生活方式为主题的社区，讨论氛围独特。', '', '["社区","技术","生活"]', '', 1700, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='docs-community'), '掘金', 'juejin', 'https://juejin.cn', '面向中文开发者的技术内容社区，覆盖前端、后端与 AI。', '', '["社区","中文","开发"]', '', 1440, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='docs-community'), '少数派', 'sspai', 'https://sspai.com', '关注数字生活、效率工具与真实体验的中文媒体。', '', '["效率","数字生活","媒体"]', '', 1206, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='docs-community'), 'InfoQ', 'infoq', 'https://www.infoq.cn', '面向企业技术决策者的资讯与深度文章，关注架构与工程实践。', '', '["资讯","架构","技术"]', '', 680, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='office'), 'Notion', 'notion', 'https://www.notion.so', '把笔记、文档、数据库与协作整合在一起的工作空间。', '', '["笔记","协作","效率"]', '', 3290, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='office'), 'Excalidraw', 'excalidraw', 'https://excalidraw.com', '手绘风格的白板工具，适合快速画流程图和系统草图。', '', '["白板","图表","效率"]', '', 1450, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='office'), 'Linear', 'linear', 'https://linear.app', '为软件团队设计的问题追踪与项目管理工具，交互极为顺滑。', '', '["项目管理","团队","效率"]', '', 980, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='office'), 'Canva', 'canva', 'https://www.canva.com', '在线平面设计工具，用模板快速完成海报、演示与社交媒体图。', '', '["设计","模板","办公"]', '', 920, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='office'), '飞书', 'feishu', 'https://www.feishu.cn', '字节跳动的协作平台，整合文档、表格、会议与即时沟通。', '', '["协作","办公","文档"]', '', 1320, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='office'), '滴答清单', 'ticktick', 'https://dida365.com', '跨平台任务管理与待办工具，支持清单、日历与习惯记录。', '', '["待办","效率","时间管理"]', '', 700, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='media'), '哔哩哔哩', 'bilibili', 'https://www.bilibili.com', '中文视频社区，覆盖知识、动画、影视与生活内容。', '', '["视频","社区","学习"]', '## 中文视频社区的一个切面

哔哩哔哩从二次元弹幕网站出发，逐渐覆盖知识、科技、影视、音乐与生活记录。它的学习区与长视频内容，常常比短视频更适合完整地理解一个主题。

## 值得关注的内容

- 大学公开课与专业科普。
- 软件教程、硬件评测与创作过程记录。
- 纪录片、访谈与独立动画。
- 小众爱好与手工制作。

## 使用建议

- 善用收藏夹与稍后再看，但定期清理。
- 关闭自动连播，给长内容留出注意力。
- 对知识类视频，优先看评论区补充与纠错。

> 视频是入口，不是结论。真正的理解仍然需要阅读、实践与讨论。', 5120, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='media'), 'YouTube', 'youtube', 'https://www.youtube.com', '全球最大的视频平台，也是学习与娱乐的超级入口。', '', '["视频","学习","娱乐"]', '', 3480, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='media'), 'Spotify', 'spotify', 'https://open.spotify.com', '流媒体音乐服务，以歌单、播客与个性化推荐见长。', '', '["音乐","播客","流媒体"]', '', 1600, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='media'), '豆瓣', 'douban', 'https://www.douban.com', '书影音标记与兴趣社区，中文互联网里独特的精神角落。', '', '["书影音","社区","记录"]', '', 1900, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='news'), '36氪', '36kr', 'https://36kr.com', '关注科技公司与商业创新的中文商业媒体。', '', '["商业","科技","资讯"]', '', 1010, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='news'), 'Hacker News', 'hackernews', 'https://news.ycombinator.com', '技术创业者与工程师的新闻讨论站，信息密度高、观点直接。', '', '["科技","社区","英文"]', '', 1330, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='news'), '澎湃新闻', 'thepaper', 'https://www.thepaper.cn', '以原创报道和时政新闻见长的中文新闻平台。', '', '["新闻","时政","中文"]', '', 680, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 hours'));
INSERT OR IGNORE INTO sites (category_id, name, slug, url, description, icon_url, tags, detail_content, jumps, ai_generated, link_status, link_checked_at) VALUES ((SELECT id FROM categories WHERE slug='news'), '界面新闻', 'jiemian', 'https://www.jiemian.com', '聚焦商业、公司与财经议题的中文新闻媒体。', '', '["商业","财经","新闻"]', '', 620, 0, 'alive', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hours'));

-- One statement per row keeps the seed compatible with D1's compound SELECT limits.
INSERT INTO comments (site_id, author, content, status, ip_hash, created_at)
SELECT s.id, '林深', '从这里顺手找到了两个正在维护的开源项目。卡片的信息密度刚好，不吵。', 'approved', 'seed', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 days')
FROM sites s
WHERE s.slug = 'github'
  AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.site_id = s.id AND c.content = '从这里顺手找到了两个正在维护的开源项目。卡片的信息密度刚好，不吵。');

INSERT INTO comments (site_id, author, content, status, ip_hash, created_at)
SELECT s.id, 'Nora', '建议在介绍里补一段如何判断仓库是否活跃，比如最近的提交和 issue 响应。', 'approved', 'seed', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days')
FROM sites s
WHERE s.slug = 'github'
  AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.site_id = s.id AND c.content = '建议在介绍里补一段如何判断仓库是否活跃，比如最近的提交和 issue 响应。');

INSERT INTO comments (site_id, author, content, status, ip_hash, created_at)
SELECT s.id, '河岸', '已经用上了，谢谢整理。希望以后能按标签筛选。', 'approved', 'seed', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-18 hours')
FROM sites s
WHERE s.slug = 'github'
  AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.site_id = s.id AND c.content = '已经用上了，谢谢整理。希望以后能按标签筛选。');

INSERT INTO comments (site_id, author, content, status, ip_hash, created_at)
SELECT s.id, '阿吉', 'Auto Layout 和变量这两部分如果能展开讲讲就好了。', 'approved', 'seed', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 days')
FROM sites s
WHERE s.slug = 'figma'
  AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.site_id = s.id AND c.content = 'Auto Layout 和变量这两部分如果能展开讲讲就好了。');

INSERT INTO comments (site_id, author, content, status, ip_hash, created_at)
SELECT s.id, '小满', '设计系统那段很实用，尤其是组件先行的建议。', 'approved', 'seed', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 days')
FROM sites s
WHERE s.slug = 'figma'
  AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.site_id = s.id AND c.content = '设计系统那段很实用，尤其是组件先行的建议。');

INSERT INTO comments (site_id, author, content, status, ip_hash, created_at)
SELECT s.id, '末末', '学习区确实有不少完整的公开课，比碎片化刷视频有效。', 'approved', 'seed', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 days')
FROM sites s
WHERE s.slug = 'bilibili'
  AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.site_id = s.id AND c.content = '学习区确实有不少完整的公开课，比碎片化刷视频有效。');

INSERT INTO comments (site_id, author, content, status, ip_hash, created_at)
SELECT s.id, '匿名访客', '这个介绍页写得不错，期待更多 AI 工具的对比。', 'pending', 'seed', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-6 hours')
FROM sites s
WHERE s.slug = 'chatgpt'
  AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.site_id = s.id AND c.content = '这个介绍页写得不错，期待更多 AI 工具的对比。');

INSERT INTO comments (site_id, author, content, status, ip_hash, created_at)
SELECT s.id, 'kevin', 'Best AI site ever, visit my telegram group for more tools.', 'pending', 'seed', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours')
FROM sites s
WHERE s.slug = 'chatgpt'
  AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.site_id = s.id AND c.content = 'Best AI site ever, visit my telegram group for more tools.');

-- 浏览计数：站点详情页读 sites.views，独立页面读 pages.views；
-- 今日总量在 daily_stats 里，一天一行。
UPDATE sites SET views = 72 WHERE slug = 'github' AND views = 0;
UPDATE pages SET views = 24 WHERE slug = 'home' AND views = 0;
UPDATE pages SET views = 8 WHERE slug = 'about' AND views = 0;

INSERT INTO daily_stats (day, views, jumps)
SELECT date('now', '+8 hours'), 30, 12
WHERE NOT EXISTS (SELECT 1 FROM daily_stats WHERE day = date('now', '+8 hours'));

-- 链接检测结果（0013 之后只有 sites 上的三个字段，不再有 link_checks 表）
UPDATE sites SET link_status = 'alive', link_checked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours')
WHERE slug = 'github' AND link_checked_at IS NULL;

UPDATE sites SET link_status = 'alive', link_checked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours')
WHERE slug = 'cloudflare' AND link_checked_at IS NULL;

UPDATE sites SET link_status = 'alive', link_checked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 hours')
WHERE slug = 'figma' AND link_checked_at IS NULL;

UPDATE sites SET link_status = 'warn', link_checked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-6 hours')
WHERE slug = 'stackoverflow' AND link_checked_at IS NULL;


-- A demo standalone page managed from the admin console.
INSERT OR IGNORE INTO pages (title, slug, excerpt, content, show_in_nav, is_published, sort_order)
VALUES (
  '友链与投稿',
  'friends',
  '交换友链、推荐站点，或者指出失效链接。',
  '## 交换友链

如果你也在维护一份认真整理的导航站或资源站，欢迎来信交换链接。请简单介绍站点主题、更新频率和访问地址。

## 推荐站点

发现了值得收录的工具、文档或独立博客？欢迎在对应站点的介绍页留言，或直接告诉我：

- 站点名称
- 网址
- 一句话说明
- 推荐理由（可选）

## 关于失效链接

链接状态由系统每日复核。如果仍然发现无法访问的站点，可以在它的详情页留言，我会尽快处理。

> 让这份索引保持干净、有用，比让它变得更大更重要。',
  1,
  1,
  20
);
