/**
 * 图标产物一致性校验（npm run icons:check）
 *
 * 背景：public/category-icons.svg、public/icons/*.svg、public/lucide-names.json 都是
 * scripts/build-icon-sprite.mjs 的产物，且已随仓库提交（.gitignore 不再忽略 public/icons/）。
 * 构建时不再重新生成，所以必须在构建前确认「仓库里的产物」与 src/lib/lucide-groups.json
 * 的配置一致，否则会出现：配置里加了图标但线上没有 → 图标空白（SPA 回退成 index.html，连 404 都没有）。
 *
 * 只读本地文件，不依赖 node_modules，几十毫秒完成。
 */

import { readFile, readdir } from "node:fs/promises";

const GROUPS = "src/lib/lucide-groups.json";
const SPRITE = "public/category-icons.svg";
const NAMES = "public/lucide-names.json";
const SINGLE_DIR = "public/icons";

const problems = [];
const fail = (message) => problems.push(message);

/** 读 JSON，失败时给出可读提示而不是抛栈 */
async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    fail(`${path} 无法读取或不是合法 JSON（${error.message}）`);
    return null;
  }
}

const groups = await readJson(GROUPS);
const sprite = await readFile(SPRITE, "utf8").catch(() => null);
const names = await readJson(NAMES);
if (sprite === null) fail(`${SPRITE} 不存在`);

// 1. 配置侧：精选名单（去重并检查重复）
const curated = [];
const curatedSet = new Set();
for (const group of Array.isArray(groups) ? groups : []) {
  for (const name of group.icons ?? []) {
    if (curatedSet.has(name)) fail(`${GROUPS} 里图标「${name}」重复出现，请先去掉重复项`);
    curatedSet.add(name);
    curated.push(name);
  }
}
if (!curated.length) fail(`${GROUPS} 里没有读到任何精选图标`);

// 2. sprite：symbol 集合必须与精选名单完全相等
if (sprite !== null) {
  const ids = [...sprite.matchAll(/<symbol id="icon-([a-z0-9-]+)"/g)].map((match) => match[1]);
  const idSet = new Set(ids);
  if (ids.length !== idSet.size) fail(`${SPRITE} 里存在重复的 <symbol>`);
  if (ids.length !== curated.length) {
    fail(`${SPRITE} 的 symbol 数（${ids.length}）与配置的精选数（${curated.length}）不一致`);
  }
  const missing = curated.filter((name) => !idSet.has(name));
  const extra = ids.filter((name) => !curatedSet.has(name));
  if (missing.length) fail(`${SPRITE} 缺少配置里的图标：${missing.slice(0, 8).join("、")}${missing.length > 8 ? ` 等 ${missing.length} 个` : ""}`);
  if (extra.length) fail(`${SPRITE} 里有配置里已不存在的图标：${extra.slice(0, 8).join("、")}${extra.length > 8 ? ` 等 ${extra.length} 个` : ""}`);
}

// 3. 单图标目录：文件集合必须等于「全集 − 精选」
const files = await readdir(SINGLE_DIR).catch(() => null);
if (files === null) {
  fail(`${SINGLE_DIR} 不存在（该目录已入库，缺了说明产物没提交）`);
} else {
  const svgFiles = files.filter((file) => file.endsWith(".svg"));
  const singleNames = new Set(svgFiles.map((file) => file.slice(0, -4)));
  const nonSvg = files.filter((file) => !file.endsWith(".svg"));
  if (nonSvg.length) fail(`${SINGLE_DIR} 里有非 .svg 文件：${nonSvg.slice(0, 5).join("、")}`);

  if (Array.isArray(names)) {
    const expected = names.filter((name) => !curatedSet.has(name));
    const expectedSet = new Set(expected);
    const missing = expected.filter((name) => !singleNames.has(name));
    const extra = [...singleNames].filter((name) => !expectedSet.has(name));
    if (missing.length) fail(`${SINGLE_DIR} 缺少图标：${missing.slice(0, 8).join("、")}${missing.length > 8 ? ` 等 ${missing.length} 个` : ""}`);
    if (extra.length) fail(`${SINGLE_DIR} 有多余图标：${extra.slice(0, 8).join("、")}${extra.length > 8 ? ` 等 ${extra.length} 个` : ""}`);
  }

  // 4. 逐个确认文件内容完整（防止半截/空文件被提交）
  const broken = [];
  await Promise.all(
    svgFiles.map(async (file) => {
      const content = await readFile(`${SINGLE_DIR}/${file}`, "utf8").catch(() => "");
      const name = file.slice(0, -4);
      if (!content.includes(`<symbol id="icon-${name}"`) || !content.includes("</symbol>")) broken.push(file);
    })
  );
  if (broken.length) fail(`${SINGLE_DIR} 有 ${broken.length} 个文件内容不完整：${broken.slice(0, 5).join("、")}`);
}

// 5. 名称表：全集必须等于「精选 ∪ 单图标」
if (Array.isArray(names)) {
  const all = new Set([...curated, ...(files ?? []).filter((f) => f.endsWith(".svg")).map((f) => f.slice(0, -4))]);
  const nameSet = new Set(names);
  if (names.length !== nameSet.size) fail(`${NAMES} 里有重复名称`);
  if (nameSet.size !== all.size) fail(`${NAMES} 的图标总数（${nameSet.size}）与 sprite + 单图标（${all.size}）不一致`);
  const missing = [...all].filter((name) => !nameSet.has(name));
  const extra = [...nameSet].filter((name) => !all.has(name));
  if (missing.length) fail(`${NAMES} 缺少：${missing.slice(0, 8).join("、")}${missing.length > 8 ? ` 等 ${missing.length} 个` : ""}`);
  if (extra.length) fail(`${NAMES} 多出：${extra.slice(0, 8).join("、")}${extra.length > 8 ? ` 等 ${extra.length} 个` : ""}`);
}

if (problems.length) {
  console.error(`✗ 图标产物与配置不同步（${problems.length} 处）：`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("\n修复：运行 npm run icons:build，然后提交 public/ 下变化的文件（sprite、lucide-names.json、icons/）。");
  process.exit(1);
}

console.log(
  `✓ 图标产物一致：${Array.isArray(groups) ? groups.length : 0} 组 / 精选 ${curated.length} / 单图标 ${(files ?? []).filter((f) => f.endsWith(".svg")).length} / 合计 ${new Set([...curated, ...(files ?? []).filter((f) => f.endsWith(".svg")).map((f) => f.slice(0, -4))]).size}`
);
