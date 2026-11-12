import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { webcrypto as crypto } from 'node:crypto';
import { collect, slugify, stripComments, write } from './publish.mjs';
import { encrypt, findLeaks, protect } from './encrypt-weekly.mjs';
import { urlFor, whenKey } from '../src/lib/notes-index.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'utr-'));
const put = (dir, name, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), text);
};
const note = (fields, body = 'Body') => `---\n${fields}\n---\n${body}\n`;
const pub = 'publish: true\ntitle: T\ntype: writing\ndate: 2026-01-02';

test('only publish: true notes are collected', () => {
  const v = tmp();
  put(v, 'yes.md', note(pub));
  put(v, 'no.md', note('publish: false\ntitle: Private'));
  put(v, 'plain.md', 'no frontmatter');
  put(v, 'text.md', note('publish: "true"\ntitle: Quoted'));
  put(v, '.obsidian/x.md', note(pub));
  const { notes, errors, scanned } = collect(v);
  assert.deepEqual(notes.map((n) => n.slug), ['yes']);
  assert.equal(errors.length, 0);
  assert.equal(scanned, 4);
});

test('private properties and comments never reach the site', () => {
  const v = tmp();
  put(v, 'a.md', note(`${pub}\nsecret_field: hidden`, 'Hi %%private%% there\n`%%keep%%`'));
  const dest = tmp();
  write(collect(v).notes, dest);
  const out = fs.readFileSync(path.join(dest, 'a.md'), 'utf8');
  assert.ok(!out.includes('secret_field'));
  assert.ok(!out.includes('publish'));
  assert.ok(!out.includes('private'));
  assert.ok(out.includes('`%%keep%%`'));
});

test('public links to Weekly stop publishing', () => {
  const v = tmp();
  put(v, 'Week 1.md', note('publish: true\ntitle: Week 1\ntype: weekly\ndate: 2026-01-02'));
  put(v, 'post.md', note(pub, 'See [[Week 1|that]]'));
  assert.match(collect(v).errors[0], /links to Weekly/);
});

test('weekly may link to public notes, and code examples are ignored', () => {
  const v = tmp();
  put(v, 'Week 1.md', note('publish: true\ntitle: Week 1\ntype: weekly\ndate: 2026-01-02', '[[post]]'));
  put(v, 'post.md', note(pub, '`[[Week 1]]`'));
  assert.equal(collect(v).errors.length, 0);
});

test('invalid notes and duplicate URLs are reported', () => {
  const v = tmp();
  put(v, 'bad.md', note('publish: true\ntitle: X\ntype: diary\ndate: 2026-01-02'));
  put(v, 'a/Same.md', note(pub));
  put(v, 'b/same.md', note(pub));
  put(v, 'book.md', note('publish: true\ntitle: B\ntype: reading\ndate: 2026-01-02'));
  assert.equal(collect(v).errors.length, 3);
});

test('slugs keep non-English letters', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world');
  assert.equal(slugify('读书 笔记'), '读书-笔记');
  assert.equal(stripComments('a%%b%%c'), 'ac');
});

test('encrypted payload round-trips and wrong password fails', async () => {
  const c = await encrypt('secret report', 'pw');
  const open = async (password) => {
    const bytes = (s) => Uint8Array.from(Buffer.from(s, 'base64'));
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: bytes(c.salt), iterations: c.iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(c.iv) }, key, bytes(c.data)));
  };
  assert.equal(await open('pw'), 'secret report');
  await assert.rejects(open('wrong'));
});

function fixture() {
  const root = tmp();
  put(root, 'notes/week-1.md', note('title: Quiet week in the orchard\ntype: weekly\ndate: 2026-01-02', 'A very distinctive private sentence about pineapples.'));
  put(root, 'dist/weekly/index.html', '<main><weekly-secret hidden="">Quiet week in the orchard. A very distinctive private sentence about pineapples.</weekly-secret></main>');
  put(root, 'dist/index.html', '<p>public</p>');
  return root;
}

test('Weekly is encrypted out of the built page', async () => {
  const r = fixture();
  await protect(path.join(r, 'dist'), path.join(r, 'notes'), 'pw');
  const page = fs.readFileSync(path.join(r, 'dist/weekly/index.html'), 'utf8');
  assert.ok(page.includes('weekly-cipher'));
  assert.ok(!page.includes('orchard'));
  assert.ok(!page.includes('weekly-secret'));
});

test('a missing password stops the build', async () => {
  const r = fixture();
  await assert.rejects(protect(path.join(r, 'dist'), path.join(r, 'notes'), ''), /WEEKLY_PASSWORD/);
});

test('a leak elsewhere deletes the build', async () => {
  const r = fixture();
  put(r, 'dist/rss.xml', '<title>Quiet week in the orchard</title>');
  await assert.rejects(protect(path.join(r, 'dist'), path.join(r, 'notes'), 'pw'), /leaked/);
  assert.equal(fs.existsSync(path.join(r, 'dist')), false);
});

test('preview images skip Weekly', async () => {
  const { generateImages } = await import('./og.mjs');
  const dir = tmp();
  const notes = [
    { slug: 'post', front: { title: 'A public title', type: 'writing' } },
    { slug: 'week', front: { title: 'Private week', type: 'weekly' } },
  ];
  const result = await generateImages(notes, dir);
  assert.equal(result.ok, true);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['default.png', 'post.png']);
});

test('long and CJK titles wrap inside the image', async () => {
  const { wrap } = await import('./og.mjs');
  assert.equal(wrap('word '.repeat(60)).length, 4);
  assert.ok(wrap('中文标题'.repeat(12)).every((l) => [...l].length <= 13));
});

test('stories are ordered by when they happened', () => {
  const written = '2026-11-11';
  const order = ['Summer 2019', 2009, '2014-06', '2014-2016', '2014-11-02', undefined, 'Age 12']
    .map((when) => [when, whenKey(when, written)])
    .sort((a, b) => a[1] - b[1])
    .map(([when]) => when);
  assert.deepEqual(order, [2009, '2014-2016', '2014-06', '2014-11-02', 'Summer 2019', undefined, 'Age 12']);
  assert.equal(urlFor('story', 'my-story'), '/stories/my-story/');
});

test('a story keeps its "when" on the way to the site', () => {
  const v = tmp();
  put(v, 's.md', note('publish: true\ntitle: S\ntype: story\ndate: 2026-01-02\nwhen: Summer 2014'));
  const { notes, errors } = collect(v);
  assert.equal(errors.length, 0);
  assert.equal(notes[0].front.when, 'Summer 2014');
});
