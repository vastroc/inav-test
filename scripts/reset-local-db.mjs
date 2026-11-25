#!/usr/bin/env node
// 把本地 D1 整个丢掉，再按 migrations/ 里的全量 schema 重新建一遍。
// 迁移只有 0001_init.sql 一个文件，重建 = 删掉库文件 + 重新应用。
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const dir = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";

try {
  for (const file of readdirSync(dir)) {
    // metadata.sqlite 存的是库与文件的对应关系，留着；只删数据文件本身
    if (!file.endsWith(".sqlite") && !file.endsWith(".sqlite-wal") && !file.endsWith(".sqlite-shm")) continue;
    if (file.startsWith("metadata.sqlite")) continue;
    rmSync(join(dir, file), { force: true });
    console.log("已删除", file);
  }
} catch {
  // 还没有本地库，直接往下走
}

// Windows 上 npx 是 .cmd，走 shell 才不会 ENOENT
const applied = spawnSync("npx wrangler d1 migrations apply DB --local", { stdio: "inherit", shell: true });
process.exit(applied.status ?? 1);
