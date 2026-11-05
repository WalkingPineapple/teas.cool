#!/usr/bin/env node
// Two-way sync between one Notion database and one vault folder.
//   npm run notion                  preview only
//   npm run notion -- --write       apply the changes
//   npm run notion -- --write --resolve local     conflicts: keep the vault version
//   npm run notion -- --write --resolve notion    conflicts: keep the Notion version
// Settings: NOTION_TOKEN, NOTION_DATABASE_ID, VAULT_PATH, NOTION_FOLDER (default Notion)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { blocksToMd, mdToBlocks, parseInline } from './notion-convert.mjs';

const STATE = '.notion-sync.json';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (s) => crypto.createHash('sha256').update(s.replace(/\r\n/g, '\n')).digest('hex');
const parse = (s) => matter(s, {});
const dateOnly = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? undefined : String(v).slice(0, 10));
const safeName = (s) => String(s).replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim().slice(0, 120) || 'Untitled';

export function client({ token, base = process.env.NOTION_API_BASE ?? 'https://api.notion.com/v1', pauseMs = 340 }) {
  async function call(method, url, body) {
    for (let attempt = 0; ; attempt += 1) {
      const res = await fetch(base + url, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.ok) { await sleep(pauseMs); return res.json(); }
      if ((res.status === 429 || res.status >= 500) && attempt < 5) {
        await sleep(Number(res.headers.get('retry-after') ?? 2 ** attempt) * 1000);
        continue;
      }
      const detail = await res.json().catch(() => ({}));
      throw new Error(`Notion ${method} ${url} failed (${res.status}): ${detail.message ?? 'unknown error'}`);
    }
  }
  async function paged(fetchPage) {
    const all = [];
    let cursor;
    do {
      const page = await fetchPage(cursor);
      all.push(...page.results);
      cursor = page.has_more ? page.next_cursor : undefined;
    } while (cursor);
    return all;
  }
  const blocks = async (id) => {
    const list = await paged((c) => call('GET', `/blocks/${id}/children?page_size=100${c ? `&start_cursor=${c}` : ''}`));
    for (const b of list) if (b.has_children) b.children = await blocks(b.id);
    return list;
  };
  return {
    database: (id) => call('GET', `/databases/${id}`),
    query: (id) => paged((c) => call('POST', `/databases/${id}/query`, { page_size: 100, ...(c ? { start_cursor: c } : {}) })),
    page: (id) => call('GET', `/pages/${id}`),
    update: (id, properties) => call('PATCH', `/pages/${id}`, { properties }),
    create: (database_id, properties, children) => call('POST', '/pages', { parent: { database_id }, properties, children }),
    append: (id, children) => call('PATCH', `/blocks/${id}/children`, { children }),
    remove: (id) => call('DELETE', `/blocks/${id}`),
    blocks,
  };
}

function schemaOf(db) {
  const find = (name, type) => {
    const hit = Object.entries(db.properties).find(([k, v]) => k.toLowerCase() === name && v.type === type);
    return hit?.[0];
  };
  return {
    title: Object.entries(db.properties).find(([, v]) => v.type === 'title')?.[0],
    date: find('date', 'date'),
    type: find('type', 'select'),
    publish: find('publish', 'checkbox'),
    summary: find('summary', 'rich_text'),
    tags: find('tags', 'multi_select'),
  };
}

const plain = (rich = []) => rich.map((r) => r.plain_text ?? r.text?.content ?? '').join('');

function fromPage(page, s) {
  const p = page.properties;
  const front = { notion_id: page.id, title: plain(p[s.title]?.title) || 'Untitled' };
  // Pages stay private unless the Publish box is ticked.
  front.publish = s.publish ? Boolean(p[s.publish]?.checkbox) : false;
  if (s.type && p[s.type]?.select) front.type = p[s.type].select.name.toLowerCase();
  if (s.date && p[s.date]?.date) front.date = p[s.date].date.start.slice(0, 10);
  if (s.summary && plain(p[s.summary]?.rich_text)) front.summary = plain(p[s.summary].rich_text);
  if (s.tags && p[s.tags]?.multi_select?.length) front.tags = p[s.tags].multi_select.map((t) => t.name);
  return front;
}

function toProps(data, fallbackTitle, s) {
  const props = { [s.title]: { title: parseInline(String(data.title ?? fallbackTitle)) } };
  if (s.publish) props[s.publish] = { checkbox: data.publish === true };
  if (s.type) props[s.type] = { select: data.type ? { name: String(data.type) } : null };
  if (s.date) props[s.date] = { date: data.date ? { start: dateOnly(data.date) } : null };
  if (s.summary) props[s.summary] = { rich_text: data.summary ? parseInline(String(data.summary)) : [] };
  if (s.tags) props[s.tags] = { multi_select: (data.tags ?? []).map((name) => ({ name: String(name) })) };
  return props;
}

function render(front, body, existing) {
  const managed = ['notion_id', 'title', 'publish', 'type', 'date', 'summary', 'tags'];
  const merged = { ...(existing ?? {}) };
  for (const key of managed) delete merged[key];
  return matter.stringify(`${body.trim()}\n`, { ...merged, ...front });
}

function localFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((n) => n.endsWith('.md') && !n.endsWith('.conflict.md'))
    .map((name) => {
      const raw = fs.readFileSync(path.join(dir, name), 'utf8');
      return { name, raw, parsed: parse(raw), hash: hash(raw) };
    });
}

function uniqueName(title, id, taken) {
  const base = safeName(title);
  const name = `${base}.md`;
  if (!taken.has(name.toLowerCase())) return name;
  return `${base} ${id.replace(/-/g, '').slice(0, 8)}.md`;
}

async function replaceBlocks(api, id, oldBlocks, md) {
  // Add the new content first, so a failed run can never leave a page empty.
  const fresh = mdToBlocks(md);
  for (let i = 0; i < fresh.length; i += 100) await api.append(id, fresh.slice(i, i + 100));
  for (const b of oldBlocks) await api.remove(b.id);
}

export async function sync({ api, databaseId, dir, write = false, resolve, log = console.log }) {
  const db = await api.database(databaseId);
  const schema = schemaOf(db);
  if (!schema.title) throw new Error('This database has no title property.');
  const pages = (await api.query(databaseId)).filter((p) => !p.archived && !p.in_trash);
  const statePath = path.join(dir, STATE);
  const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { notes: {} };
  const save = () => {
    if (!write) return;
    fs.writeFileSync(`${statePath}.tmp`, JSON.stringify(state, null, 2));
    fs.renameSync(`${statePath}.tmp`, statePath);
  };
  if (write) fs.mkdirSync(dir, { recursive: true });

  const files = localFiles(dir);
  const byId = new Map(files.filter((f) => f.parsed.data.notion_id).map((f) => [f.parsed.data.notion_id, f]));
  const taken = new Set(files.map((f) => f.name.toLowerCase()));
  const seen = new Set();
  const report = { pulled: [], pushed: [], created: [], conflicts: [], blocked: [], orphaned: [], unchanged: 0 };

  const pullContent = async (page) => {
    const { md, lossy } = blocksToMd(await api.blocks(page.id));
    return { front: fromPage(page, schema), md, lossy };
  };
  const remember = (id, page, name, text, lossy) => {
    state.notes[id] = { file: name, notionEdited: page.last_edited_time, localHash: hash(text), lossy };
    save();
  };
  const pull = async (page, file, content) => {
    const name = file?.name ?? uniqueName(content.front.title, page.id, taken);
    taken.add(name.toLowerCase());
    const text = render(content.front, content.md, file?.parsed.data);
    report.pulled.push(name);
    if (!write) return;
    fs.writeFileSync(path.join(dir, name), text);
    remember(page.id, page, name, text, content.lossy);
  };
  const push = async (page, file) => {
    const current = await api.blocks(page.id);
    const { lossy } = blocksToMd(current);
    if (lossy.length) {
      report.blocked.push(`${file.name}: Notion has content Markdown can't hold (${lossy.join(', ')}). Edit this one in Notion.`);
      return;
    }
    report.pushed.push(file.name);
    if (!write) return;
    await api.update(page.id, toProps(file.parsed.data, path.basename(file.name, '.md'), schema));
    await replaceBlocks(api, page.id, current, file.parsed.content);
    remember(page.id, await api.page(page.id), file.name, file.raw, []);
  };

  for (const page of pages) {
    seen.add(page.id);
    const file = byId.get(page.id);
    const known = state.notes[page.id];
    if (!file) {
      if (known) { report.orphaned.push(`${known.file}: deleted from the vault, kept in Notion`); continue; }
      await pull(page, undefined, await pullContent(page));
      continue;
    }
    const remoteChanged = !known || known.notionEdited !== page.last_edited_time;
    const localChanged = !known || known.localHash !== file.hash;
    if (!remoteChanged && !localChanged) { report.unchanged += 1; continue; }
    if (remoteChanged && !localChanged) { await pull(page, file, await pullContent(page)); continue; }
    if (!remoteChanged) { await push(page, file); continue; }

    // Both sides changed. Never pick a winner silently.
    const content = await pullContent(page);
    const remoteText = render(content.front, content.md, file.parsed.data);
    if (hash(remoteText) === file.hash) {
      if (write) remember(page.id, page, file.name, file.raw, content.lossy);
      report.unchanged += 1;
    } else if (resolve === 'notion') await pull(page, file, content);
    else if (resolve === 'local') await push(page, file);
    else {
      const copy = file.name.replace(/\.md$/, '.conflict.md');
      report.conflicts.push(`${file.name} (Notion version saved as ${copy})`);
      if (write) {
        const { publish, ...safe } = content.front;
        fs.writeFileSync(path.join(dir, copy), matter.stringify(`${content.md.trim()}\n`, safe));
      }
    }
  }

  for (const file of files) {
    const id = file.parsed.data.notion_id;
    if (id && seen.has(id)) continue;
    if (id) { report.orphaned.push(`${file.name}: removed from Notion, kept in the vault`); continue; }
    report.created.push(file.name);
    if (!write) continue;
    const blocks = mdToBlocks(file.parsed.content);
    const page = await api.create(databaseId, toProps(file.parsed.data, path.basename(file.name, '.md'), schema), blocks.slice(0, 100));
    for (let i = 100; i < blocks.length; i += 100) await api.append(page.id, blocks.slice(i, i + 100));
    const text = matter.stringify(file.parsed.content, { ...file.parsed.data, notion_id: page.id });
    fs.writeFileSync(path.join(dir, file.name), text);
    remember(page.id, await api.page(page.id), file.name, text, []);
  }

  const section = (title, list) => { if (list.length) log(`${title}:\n${list.map((x) => `  - ${x}`).join('\n')}`); };
  section('Notion to vault', report.pulled);
  section('Vault to Notion', report.pushed);
  section('New in Notion', report.created);
  section('Conflicts', report.conflicts);
  section('Not synced', report.blocked);
  section('Removed on one side', report.orphaned);
  log(`${report.unchanged} unchanged.${write ? '' : ' Preview only: add --write to apply.'}`);
  return report;
}

async function main() {
  try { process.loadEnvFile('.env'); } catch {}
  const args = process.argv.slice(2);
  const { NOTION_TOKEN, NOTION_DATABASE_ID, VAULT_PATH, NOTION_FOLDER = 'Notion' } = process.env;
  const at = args.indexOf('--vault');
  const vault = at >= 0 ? args[at + 1] : VAULT_PATH;
  if (!NOTION_TOKEN || !NOTION_DATABASE_ID || !vault) {
    console.error('Set NOTION_TOKEN, NOTION_DATABASE_ID, and VAULT_PATH in .env first. See the README.');
    process.exit(1);
  }
  const r = args.indexOf('--resolve');
  const resolve = r >= 0 ? args[r + 1] : undefined;
  if (resolve && !['local', 'notion'].includes(resolve)) {
    console.error('--resolve must be local or notion.');
    process.exit(1);
  }
  await sync({
    api: client({ token: NOTION_TOKEN }),
    databaseId: NOTION_DATABASE_ID,
    dir: path.join(vault, NOTION_FOLDER),
    write: args.includes('--write'),
    resolve,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
