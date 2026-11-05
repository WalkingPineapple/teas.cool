import test from 'node:test';
import assert from 'node:assert/strict';
import { remark } from 'remark';
import remarkObsidian from '../src/lib/remark-obsidian.mjs';

const public_ = { slug: 'post', title: 'A Post', type: 'writing', url: '/writing/post/' };
const weekly = { slug: 'w1', title: 'W1', type: 'weekly', url: '/weekly/#w1' };
const index = {
  byName: new Map([['a post', public_], ['post', public_], ['w1', weekly]]),
  bySlug: new Map([['post', public_], ['w1', weekly]]),
};
async function tree(md, opts = {}) {
  const p = remark().use(remarkObsidian, { index, imageBaseUrl: '', ...opts });
  return p.run(p.parse(md), { path: opts.path });
}
const kids = (t) => t.children[0].children;

test('wikilinks resolve, with aliases and headings', async () => {
  const c = kids(await tree('See [[A Post#Big Idea|this]] now'));
  assert.equal(c[1].url, '/writing/post/#big-idea');
  assert.equal(c[1].children[0].value, 'this');
  assert.equal(c[2].value, ' now');
});

test('links to unpublished notes become plain text', async () => {
  const c = kids(await tree('See [[Secret plan]] now'));
  assert.equal(c.length, 3);
  assert.equal(c[1].type, 'text');
  assert.equal(c[1].value, 'Secret plan');
});

test('public notes cannot link to Weekly, but Weekly can', async () => {
  assert.equal(kids(await tree('[[w1]]'))[0].type, 'text');
  assert.equal(kids(await tree('[[w1]]', { path: 'x/w1.md' }))[0].type, 'link');
});

test('code stays untouched', async () => {
  assert.equal((await tree('`[[A Post]]`')).children[0].children[0].type, 'inlineCode');
});

test('image embeds use the configured host', async () => {
  const c = kids(await tree('![[my photo.png]]', { imageBaseUrl: 'https://img.example.com/' }));
  assert.equal(c[0].url, 'https://img.example.com/my%20photo.png');
});

test('callouts render with titles', async () => {
  const n = (await tree('> [!note] Heads up\n> Body')).children[0];
  assert.equal(n.data.hName, 'aside');
  assert.equal(n.children[0].children[0].value, 'Heads up');
  assert.equal(n.children[1].children[0].value, 'Body');
});

test('the under callout folds', async () => {
  const n = (await tree('> [!under]\n> Deep dive')).children[0];
  assert.equal(n.data.hName, 'details');
  assert.equal(n.children[0].data.hName, 'summary');
  assert.equal(n.children[0].children[0].value, 'Look under the rind');
});

test('ordinary quotes stay quotes, and mermaid becomes a diagram block', async () => {
  const t = await tree('> Just a quote\n\n```mermaid\ngraph TD; A-->B\n```');
  assert.equal(t.children[0].data, undefined);
  assert.match(t.children[1].value, /^<pre class="mermaid">graph TD; A--&gt;B/);
});

test('margin callouts become side notes with no title', async () => {
  const n = (await tree('> [!margin] Beside the text')).children[0];
  assert.deepEqual(n.data.hProperties.className, ['margin-note']);
  assert.equal(n.children[0].children[0].value, 'Beside the text');
});
