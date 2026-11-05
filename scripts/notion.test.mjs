import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { blocksToMd, mdToBlocks } from './notion-convert.mjs';
import { sync } from './notion-sync.mjs';

const para = (t, id = 'b') => ({ id, type: 'paragraph', paragraph: { rich_text: [{ plain_text: t, annotations: {} }] } });

function fakeNotion() {
  let clock = 0; let n = 0;
  const tick = () => `2026-01-01T00:${String(++clock).padStart(2, '0')}:00.000Z`;
  const pages = new Map();
  const db = { properties: {
    Name: { type: 'title' }, Date: { type: 'date' }, Type: { type: 'select' },
    Publish: { type: 'checkbox' }, Summary: { type: 'rich_text' }, Tags: { type: 'multi_select' },
  } };
  const props = (title, publish = false) => ({
    Name: { title: [{ plain_text: title }] }, Publish: { checkbox: publish },
    Type: { select: { name: 'Writing' } }, Date: { date: { start: '2026-01-02' } },
    Summary: { rich_text: [] }, Tags: { multi_select: [] },
  });
  const normal = (p) => {
    const out = structuredClone(p);
    if (out.Name?.title) out.Name.title = out.Name.title.map((r) => ({ plain_text: r.text?.content ?? r.plain_text }));
    return out;
  };
  const stamp = (b) => ({ ...b, id: `b${++n}` });
  return {
    pages, tick, calls: [],
    seed(id, title, blocks, publish) { pages.set(id, { id, properties: props(title, publish), blocks, last_edited_time: tick() }); },
    edit(id, blocks) { const p = pages.get(id); p.blocks = blocks; p.last_edited_time = tick(); },
    database: async () => db,
    query: async () => [...pages.values()],
    page: async (id) => pages.get(id),
    blocks: async (id) => [...pages.get(id).blocks],
    async update(id, properties) { const p = pages.get(id); p.properties = { ...p.properties, ...normal(properties) }; p.last_edited_time = tick(); },
    async create(_, properties, children) {
      const id = `new-${++n}`;
      const p = { id, properties: normal(properties), blocks: children.map(stamp), last_edited_time: tick() };
      pages.set(id, p); return p;
    },
    async append(id, kids) { const p = pages.get(id); p.blocks.push(...kids.map(stamp)); p.last_edited_time = tick(); },
    async remove(id) {
      for (const p of pages.values()) {
        const before = p.blocks.length;
        p.blocks = p.blocks.filter((b) => b.id !== id);
        if (p.blocks.length !== before) p.last_edited_time = tick();
      }
    },
  };
}
const setup = () => ({ api: fakeNotion(), dir: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'notion-')), 'Notion') });
const run = (ctx, extra = {}) => sync({ api: ctx.api, databaseId: 'db', dir: ctx.dir, write: true, log: () => {}, ...extra });
const read = (ctx, name) => fs.readFileSync(path.join(ctx.dir, name), 'utf8');
const editLocal = (ctx, name, from, to) => fs.writeFileSync(path.join(ctx.dir, name), read(ctx, name).replace(from, to));

test('Markdown survives a round trip through Notion blocks', () => {
  const md = `## Heading

A **bold** word, *italic*, \`code\`, ~~gone~~, [a link](https://x.dev), and $x^2$.

- one
  - nested
- two

1. first
2. second

- [x] done

> A quote

---

\`\`\`python
print("hi")
\`\`\`

$$
a + b
$$

![photo](https://img.example.com/a.png)`;
  const back = (blocks) => blocks.map((b) => ({
    ...b,
    children: b[b.type]?.children,
  }));
  const { md: out, lossy } = blocksToMd(back(mdToBlocks(md)));
  assert.equal(out, md);
  assert.deepEqual(lossy, []);
});

test('unsupported Notion blocks are flagged', () => {
  const { lossy, md } = blocksToMd([{ type: 'child_database', child_database: {} }]);
  assert.deepEqual(lossy, ['child_database']);
  assert.ok(md.startsWith('%%'));
});

test('new Notion pages arrive private by default', async () => {
  const c = setup();
  c.api.seed('p1', 'Hello', [para('Body text')]);
  await run(c);
  const { data, content } = matter(read(c, 'Hello.md'));
  assert.equal(data.publish, false);
  assert.equal(data.notion_id, 'p1');
  assert.match(content, /Body text/);
});

test('preview changes nothing on either side', async () => {
  const c = setup();
  c.api.seed('p1', 'Hello', [para('Body')]);
  await run(c, { write: false });
  assert.equal(fs.existsSync(c.dir), false);
});

test('Notion edits reach the vault', async () => {
  const c = setup();
  c.api.seed('p1', 'Hello', [para('Old')]);
  await run(c);
  c.api.edit('p1', [para('New from Notion')]);
  const r = await run(c);
  assert.deepEqual(r.pulled, ['Hello.md']);
  assert.match(read(c, 'Hello.md'), /New from Notion/);
});

test('vault edits reach Notion and old blocks go only after new ones land', async () => {
  const c = setup();
  c.api.seed('p1', 'Hello', [para('Old')]);
  await run(c);
  editLocal(c, 'Hello.md', 'Old', 'New from vault');
  const r = await run(c);
  assert.deepEqual(r.pushed, ['Hello.md']);
  const blocks = c.api.pages.get('p1').blocks;
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].paragraph.rich_text[0].text.content, 'New from vault');
  const again = await run(c);
  assert.equal(again.unchanged, 1);
  assert.equal(again.pushed.length + again.pulled.length, 0);
});

test('new vault notes create Notion pages once', async () => {
  const c = setup();
  fs.mkdirSync(c.dir, { recursive: true });
  fs.writeFileSync(path.join(c.dir, 'Local.md'), '---\ntitle: Local\ntype: writing\ndate: 2026-02-03\npublish: true\n---\nFrom the vault\n');
  const r = await run(c);
  assert.deepEqual(r.created, ['Local.md']);
  assert.ok(matter(read(c, 'Local.md')).data.notion_id);
  assert.equal(c.api.pages.size, 1);
  await run(c);
  assert.equal(c.api.pages.size, 1);
});

test('edits on both sides lose nothing', async () => {
  const c = setup();
  c.api.seed('p1', 'Hello', [para('Base')]);
  await run(c);
  editLocal(c, 'Hello.md', 'Base', 'Vault edit');
  c.api.edit('p1', [para('Notion edit')]);
  const r = await run(c);
  assert.equal(r.conflicts.length, 1);
  assert.match(read(c, 'Hello.md'), /Vault edit/);
  assert.match(read(c, 'Hello.conflict.md'), /Notion edit/);
  assert.equal(c.api.pages.get('p1').blocks[0].paragraph.rich_text[0].plain_text, 'Notion edit');
  assert.equal(matter(read(c, 'Hello.conflict.md')).data.publish, undefined);
});

test('conflicts can be resolved either way', async () => {
  const c = setup();
  c.api.seed('p1', 'Hello', [para('Base')]);
  await run(c);
  editLocal(c, 'Hello.md', 'Base', 'Vault edit');
  c.api.edit('p1', [para('Notion edit')]);
  await run(c, { resolve: 'local' });
  assert.equal(c.api.pages.get('p1').blocks[0].paragraph.rich_text[0].text.content, 'Vault edit');
});

test('pages with Notion-only content are never overwritten', async () => {
  const c = setup();
  const table = { id: 't', type: 'table', table: {} };
  c.api.seed('p1', 'Hello', [para('Text', 'a'), table]);
  await run(c);
  editLocal(c, 'Hello.md', 'Text', 'Changed');
  const r = await run(c);
  assert.equal(r.blocked.length, 1);
  assert.equal(c.api.pages.get('p1').blocks.length, 2);
});

test('deleting on one side never deletes on the other', async () => {
  const c = setup();
  c.api.seed('p1', 'One', [para('A')]);
  c.api.seed('p2', 'Two', [para('B')]);
  await run(c);
  fs.rmSync(path.join(c.dir, 'One.md'));
  c.api.pages.get('p2').archived = true;
  const r = await run(c);
  assert.equal(r.orphaned.length, 2);
  assert.ok(c.api.pages.has('p1'));
  assert.ok(fs.existsSync(path.join(c.dir, 'Two.md')));
});

test('unsafe page titles stay inside the sync folder', async () => {
  const c = setup();
  c.api.seed('p1', '../../evil:name', [para('x')]);
  await run(c);
  const names = fs.readdirSync(c.dir).filter((n) => n.endsWith('.md'));
  assert.equal(names.length, 1);
  assert.ok(!names[0].includes('/'));
  assert.ok(!names[0].includes(':'));
});

test('Windows line endings do not count as an edit', async () => {
  const c = setup();
  c.api.seed('p1', 'Hello', [para('Text')]);
  await run(c);
  fs.writeFileSync(path.join(c.dir, 'Hello.md'), read(c, 'Hello.md').replace(/\n/g, '\r\n'));
  const r = await run(c);
  assert.equal(r.pushed.length, 0);
});
