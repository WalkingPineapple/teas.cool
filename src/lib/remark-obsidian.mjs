import path from 'node:path';
import { visit, SKIP } from 'unist-util-visit';
import site from '../../site.config.mjs';
import { buildIndex, norm } from './notes-index.mjs';

const TOKEN = /(!?)\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;
const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const CALLOUT = /^\[!([\w-]+)\]([+-]?)[ \t]*(.*)$/;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slugHeading = (s) => s.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');

function wikiNodes(value, index, self, imageBase) {
  const out = [];
  let last = 0;
  for (const m of value.matchAll(TOKEN)) {
    const [raw, bang, target, heading = '', alias] = m;
    if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index) });
    last = m.index + raw.length;
    const label = alias?.trim() || target.trim();
    const name = target.trim();

    if (bang && IMAGE.test(name)) {
      if (/^https?:/.test(name)) out.push({ type: 'image', url: name, alt: alias ?? '' });
      else if (imageBase) out.push({ type: 'image', url: `${imageBase.replace(/\/$/, '')}/${encodeURI(name)}`, alt: alias ?? '' });
      else out.push({ type: 'text', value: label });
      continue;
    }
    const note = index.byName.get(norm(name));
    // Never expose a weekly report from a public note. Unpublished notes become plain text.
    if (!note || (note.type === 'weekly' && self?.type !== 'weekly')) {
      out.push({ type: 'text', value: label });
      continue;
    }
    const anchor = heading ? `#${slugHeading(heading.slice(1))}` : '';
    out.push({
      type: 'link',
      url: note.url + (note.type === 'weekly' ? '' : anchor),
      data: { hProperties: { className: ['wikilink'], 'data-note': note.slug } },
      children: [{ type: 'text', value: alias?.trim() || (bang ? note.title : target.trim()) }],
    });
  }
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out;
}

function applyCallout(node) {
  const para = node.children[0];
  const first = para?.type === 'paragraph' ? para.children[0] : null;
  if (first?.type !== 'text') return;
  const [line, ...rest] = first.value.split('\n');
  const m = line.match(CALLOUT);
  if (!m) return;
  const [, rawKind, fold, rawTitle] = m;
  const kind = rawKind.toLowerCase();
  if (kind === 'margin') {
    first.value = [rawTitle, ...rest].filter(Boolean).join('\n');
    if (!first.value) para.children.shift();
    node.data = { hName: 'aside', hProperties: { className: ['margin-note'] } };
    return;
  }
  const under = kind === 'under';
  const foldable = under || fold === '+' || fold === '-';
  const title = rawTitle.trim() || (under ? 'Look under the rind' : kind[0].toUpperCase() + kind.slice(1));

  first.value = rest.join('\n');
  if (!first.value) para.children.shift();
  if (!para.children.length) node.children.shift();

  node.data = {
    hName: foldable ? 'details' : 'aside',
    hProperties: { className: ['callout', `callout-${kind}`], ...(fold === '+' ? { open: true } : {}) },
  };
  node.children.unshift({
    type: 'paragraph',
    data: { hName: foldable ? 'summary' : 'p', hProperties: { className: ['callout-title'] } },
    children: [{ type: 'text', value: title }],
  });
}

export default function remarkObsidian(options = {}) {
  return (tree, file) => {
    const index = options.index ?? buildIndex();
    const imageBase = options.imageBaseUrl ?? site.imageBaseUrl;
    const self = file?.path ? index.bySlug.get(path.basename(file.path, '.md')) : undefined;

    visit(tree, 'blockquote', applyCallout);

    visit(tree, 'code', (node, i, parent) => {
      if (node.lang !== 'mermaid' || !parent) return;
      parent.children[i] = { type: 'html', value: `<pre class="mermaid">${esc(node.value)}</pre>` };
      return SKIP;
    });

    visit(tree, 'text', (node, i, parent) => {
      if (!parent || !node.value.includes('[[')) return;
      const nodes = wikiNodes(node.value, index, self, imageBase);
      if (nodes.length === 1 && nodes[0].type === 'text' && nodes[0].value === node.value) return;
      parent.children.splice(i, 1, ...nodes);
      return [SKIP, i + nodes.length];
    });
  };
}
