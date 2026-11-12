#!/usr/bin/env node
// 一键发布：vault → 校验 → 写入站点笔记 → OG 图 → git 提交推送 → Cloudflare 自动部署。
//   npm run deploy                      用 .env 里的 VAULT_PATH
//   blog --vault "C:\path\to\vault"     指定 vault（全局命令同理）
//   blog --dry                          只预览要发布什么，不改任何东西
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect, write } from './publish.mjs';
import { generateImages } from './og.mjs';

// 不管从哪里调用，都在仓库根目录下工作
process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
try { process.loadEnvFile('.env'); } catch {}

const args = process.argv.slice(2);
const at = args.indexOf('--vault');
const vault = at >= 0 ? args[at + 1] : process.env.VAULT_PATH;
const dry = args.includes('--dry');

if (!vault || !fs.existsSync(vault)) {
  console.error('没找到 vault。用法：blog --vault "C:\\path\\to\\vault"，或在仓库 .env 里写一行 VAULT_PATH=C:\\path\\to\\vault');
  process.exit(1);
}

const { notes, errors, scanned } = collect(vault);
console.log(`扫描 ${scanned} 篇笔记，其中 ${notes.length} 篇标记了 publish: true。`);
for (const n of notes) console.log(`  ${n.front.type.padEnd(10)} ${n.slug}`);

// 有任何问题（缺字段、撞 URL、公开笔记链到周报……）就停，一个字都不改
if (errors.length) {
  console.error(`\n发现 ${errors.length} 个问题，本次未发布：`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
if (dry) {
  console.log('\n预览模式（--dry）：没有写入、没有提交。去掉 --dry 就是正式发布。');
  process.exit(0);
}

write(notes, path.join('src', 'content', 'notes'));
const images = await generateImages(notes, path.join('public', 'og'));
console.log(images.ok ? `OG 分享图已生成（${images.count} 张）。` : `OG 图跳过：${images.reason}`);

const run = (cmd, ...a) => execFileSync(cmd, a, { stdio: 'inherit' });
run('git', 'add', '-A');
const dirty = execFileSync('git', ['status', '--porcelain']).toString().trim();
if (!dirty) {
  console.log('\n和上次发布没有变化，不用再发。');
  process.exit(0);
}
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
run('git', 'commit', '-m', `发布笔记 ${stamp}`);
run('git', 'push');
console.log('\n已推送，Cloudflare 正在构建，一两分钟后生效：https://teas.cool');
