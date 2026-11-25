/**
 * 从 lucide-static 生成图标资源：
 *  - public/category-icons.svg ：精选图标（src/lib/lucide-groups.json 里的分组顺序）合成一个 sprite，
 *    每页都会用到，一次请求约 85 KB。
 *  - public/icons/<name>.svg  ：精选之外的每个图标单独一个文件（约 350 字节），
 *    只有某个分类真的用了这个图标时，浏览器才会去取它，不再整包下载 789 KB 全量 sprite。
 *  - public/lucide-names.json ：全量名称表，供后台图标弹窗做全库搜索与自定义名称校验。
 *
 * 用法：npm run icons:build（npm run build 会自动先执行）
 */
import { readFile, writeFile, readdir, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";

const ICON_DIR = "node_modules/lucide-static/icons";
const GROUPS_FILE = "src/lib/lucide-groups.json";
const SINGLE_OUT_DIR = "public/icons";

const groups = JSON.parse(await readFile(GROUPS_FILE, "utf8"));
const files = (await readdir(ICON_DIR)).filter((name) => name.endsWith(".svg")).sort();
const all = files.map((name) => name.slice(0, -4));

const available = new Set(all);
const missing = [];
const duplicates = [];
const seen = new Set();

for (const group of groups) {
  for (const icon of group.icons) {
    if (!available.has(icon)) missing.push(group.label + " → " + icon);
    if (seen.has(icon)) duplicates.push(icon);
    seen.add(icon);
  }
}

if (missing.length || duplicates.length) {
  if (missing.length) console.error("✗ 图标库里找不到：\n  " + missing.join("\n  "));
  if (duplicates.length) console.error("✗ 分组里重复：\n  " + duplicates.join("\n  "));
  process.exitCode = 1;
}

const cache = new Map();

/** 取出 <svg> 内部的图形标记，压成一行，放进 <symbol> 里 */
async function inner(name) {
  if (!cache.has(name)) {
    const text = await readFile(join(ICON_DIR, name + ".svg"), "utf8");
    const start = text.indexOf(">", text.indexOf("<svg")) + 1;
    const end = text.lastIndexOf("</svg>");
    const body = text.slice(start, end).replace(/\s+/g, " ").trim();
    cache.set(name, body);
  }
  return cache.get(name);
}

function symbol(name, body) {
  return (
    '<symbol id="icon-' +
    name +
    '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    body +
    "</symbol>"
  );
}

async function writeSprite(file, names, title) {
  const rows = [];
  for (const name of names) rows.push("  " + symbol(name, await inner(name)));
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg">\n' +
    "  <!-- " + title + "，由 scripts/build-icon-sprite.mjs 生成，请勿手改 -->\n" +
    "  <defs>\n" +
    rows.join("\n") +
    "\n  </defs>\n</svg>\n";
  await writeFile(file, svg);
  return Buffer.byteLength(svg);
}

/** 单个图标的迷你 sprite：结构与合集完全一致，<use href="/icons/x.svg#icon-x"> 直接命中 */
function miniSprite(name, body) {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg">\n' +
    "  <!-- 单个图标，由 scripts/build-icon-sprite.mjs 生成，请勿手改 -->\n" +
    "  <defs>" +
    symbol(name, body) +
    "</defs>\n</svg>\n"
  );
}

const curated = groups.flatMap((group) => group.icons).filter((icon) => available.has(icon));
const curatedSize = await writeSprite("public/category-icons.svg", curated, "精选图标 " + curated.length + " 个");

// 目录保留，只删「上一轮有、这一轮不需要」的过期文件（Lucide 改名后留下的孤儿）
await mkdir(SINGLE_OUT_DIR, { recursive: true });
const curatedSet = new Set(curated);
const singles = all.filter((name) => !curatedSet.has(name));
const keep = new Set(singles.map((name) => name + ".svg"));
const stale = (await readdir(SINGLE_OUT_DIR).catch(() => [])).filter((file) => file.endsWith(".svg") && !keep.has(file));
for (const file of stale) {
  await unlink(join(SINGLE_OUT_DIR, file)).catch(() => {});
}

let singleBytes = 0;
for (const name of singles) {
  const svg = miniSprite(name, await inner(name));
  singleBytes += Buffer.byteLength(svg);
  await writeFile(join(SINGLE_OUT_DIR, name + ".svg"), svg);
}

await writeFile("public/lucide-names.json", JSON.stringify(all));

console.log("精选 sprite：" + curated.length + " 个， " + Math.round(curatedSize / 1024) + " KB");
console.log(
  "单图标文件：" + singles.length + " 个，" + Math.round(singleBytes / 1024) + " KB 总计，平均 " +
    Math.round(singleBytes / Math.max(1, singles.length)) + " B/个",
);
if (process.exitCode) console.error("请修正 " + GROUPS_FILE + " 后重跑。");
