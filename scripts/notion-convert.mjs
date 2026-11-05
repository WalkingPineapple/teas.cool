// Converts between Notion blocks and Markdown. Anything that can't survive the
// round trip is reported as `lossy`, so sync can refuse to overwrite it in Notion.

const LIMIT = 2000;
const text = (content, annotations = {}, url) => ({
  type: 'text', text: { content, ...(url ? { link: { url } } : {}) }, annotations,
});

const INLINE = /(`[^`\n]+`)|(\$[^$\n]+\$)|(\*\*[^\n]+?\*\*)|(~~[^\n]+?~~)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\([^)\s]+\))/;

export function parseInline(input, annotations = {}, url) {
  const out = [];
  let rest = input;
  while (rest) {
    const m = rest.match(INLINE);
    if (!m) { out.push(...split(rest, annotations, url)); break; }
    if (m.index) out.push(...split(rest.slice(0, m.index), annotations, url));
    const t = m[0];
    if (m[1]) out.push(text(t.slice(1, -1), { ...annotations, code: true }, url));
    else if (m[2]) out.push({ type: 'equation', equation: { expression: t.slice(1, -1) }, annotations });
    else if (m[3]) out.push(...parseInline(t.slice(2, -2), { ...annotations, bold: true }, url));
    else if (m[4]) out.push(...parseInline(t.slice(2, -2), { ...annotations, strikethrough: true }, url));
    else if (m[5]) out.push(...parseInline(t.slice(1, -1), { ...annotations, italic: true }, url));
    else {
      const [, label, href] = t.match(/^\[([^\]]+)\]\((.+)\)$/);
      out.push(...parseInline(label, annotations, href));
    }
    rest = rest.slice(m.index + t.length);
  }
  return out;
}

function split(content, annotations, url) {
  const parts = [];
  for (let i = 0; i < content.length; i += LIMIT) parts.push(text(content.slice(i, i + LIMIT), annotations, url));
  return parts;
}

export function richToMd(rich = []) {
  return rich.map((r) => {
    if (r.type === 'equation') return `$${r.equation.expression}$`;
    let s = r.plain_text ?? r.text?.content ?? '';
    const a = r.annotations ?? {};
    if (a.code) s = `\`${s}\``;
    if (a.italic) s = `*${s}*`;
    if (a.bold) s = `**${s}**`;
    if (a.strikethrough) s = `~~${s}~~`;
    const href = r.href ?? r.text?.link?.url;
    return href ? `[${s}](${href})` : s;
  }).join('');
}

const block = (type, data, extra = {}) => ({ object: 'block', type, [type]: data, ...extra });
const rich = (s) => parseInline(s);

function parseList(lines, start) {
  const items = [];
  let i = start;
  const baseIndent = lines[start].match(/^\s*/)[0].length;
  while (i < lines.length) {
    const m = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (!m || m[1].length < baseIndent) break;
    if (m[1].length > baseIndent) {
      const [children, next] = parseList(lines, i);
      const parent = items.at(-1);
      if (parent) parent[parent.type].children = children;
      i = next;
      continue;
    }
    const task = m[3].match(/^\[( |x|X)\]\s+(.*)$/);
    if (task) items.push(block('to_do', { rich_text: rich(task[2]), checked: task[1] !== ' ' }));
    else if (/\d/.test(m[2])) items.push(block('numbered_list_item', { rich_text: rich(m[3]) }));
    else items.push(block('bulleted_list_item', { rich_text: rich(m[3]) }));
    i += 1;
  }
  return [items, i];
}

const isSpecial = (l) => /^(#{1,6}\s|```|>|\s*([-*+]|\d+\.)\s|---\s*$|\$\$\s*$|!\[)/.test(l);

export function mdToBlocks(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    const fence = line.match(/^```(\S*)/);
    if (fence) {
      const code = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i += 1;
      out.push(block('code', { language: fence[1] || 'plain text', rich_text: split(code.join('\n'), {}) }));
      continue;
    }
    if (/^\$\$\s*$/.test(line)) {
      const expr = [];
      i += 1;
      while (i < lines.length && !/^\$\$\s*$/.test(lines[i])) expr.push(lines[i++]);
      i += 1;
      out.push(block('equation', { expression: expr.join('\n') }));
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 3);
      out.push(block(`heading_${level}`, { rich_text: rich(heading[2]) }));
      i += 1;
      continue;
    }
    if (/^---\s*$/.test(line)) { out.push(block('divider', {})); i += 1; continue; }
    const image = line.match(/^!\[([^\]]*)\]\((\S+)\)\s*$/);
    if (image) {
      out.push(block('image', { type: 'external', external: { url: image[2] }, ...(image[1] ? { caption: rich(image[1]) } : {}) }));
      i += 1;
      continue;
    }
    if (line.startsWith('>')) {
      const quote = [];
      while (i < lines.length && lines[i].startsWith('>')) quote.push(lines[i++].replace(/^>\s?/, ''));
      const head = quote[0].match(/^\[!([\w-]+)\][+-]?\s*(.*)$/);
      if (head) {
        const body = [...(head[2] ? [head[2]] : []), ...quote.slice(1)].join('\n');
        out.push(block('callout', { rich_text: rich(body), icon: { type: 'emoji', emoji: '💡' } }));
      } else out.push(block('quote', { rich_text: rich(quote.join('\n')) }));
      continue;
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const [items, next] = parseList(lines, i);
      out.push(...items);
      i = next;
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && (!para.length || !isSpecial(lines[i]))) para.push(lines[i++]);
    out.push(block('paragraph', { rich_text: rich(para.join('\n')) }));
  }
  return out;
}

export function blocksToMd(blocks, depth = 0) {
  const lossy = [];
  const parts = [];
  const pad = '  '.repeat(depth);
  let counter = 0;

  blocks.forEach((b) => {
    const data = b[b.type] ?? {};
    const body = richToMd(data.rich_text);
    const kids = () => {
      if (!b.children?.length) return '';
      const inner = blocksToMd(b.children, depth + 1);
      lossy.push(...inner.lossy);
      return `\n${inner.md}`;
    };
    if (b.type !== 'numbered_list_item') counter = 0;
    switch (b.type) {
      case 'paragraph':
        if (body) parts.push(pad + body);
        if (b.children?.length) lossy.push('nested paragraph');
        break;
      case 'heading_1': case 'heading_2': case 'heading_3':
        if (data.is_toggleable) lossy.push('toggle heading');
        parts.push(`${'#'.repeat(Number(b.type.at(-1)))} ${body}`);
        break;
      case 'bulleted_list_item': parts.push(`${pad}- ${body}${kids()}`); break;
      case 'numbered_list_item': counter += 1; parts.push(`${pad}${counter}. ${body}${kids()}`); break;
      case 'to_do': parts.push(`${pad}- [${data.checked ? 'x' : ' '}] ${body}${kids()}`); break;
      case 'quote':
        parts.push(body.split('\n').map((l) => `> ${l}`).join('\n'));
        if (b.children?.length) lossy.push('nested quote');
        break;
      case 'callout':
        parts.push(`> [!note]\n${body.split('\n').map((l) => `> ${l}`).join('\n')}`);
        if (b.children?.length) lossy.push('nested callout');
        break;
      case 'code': {
        const language = data.language === 'plain text' ? '' : data.language;
        parts.push(`\`\`\`${language}\n${(data.rich_text ?? []).map((r) => r.plain_text ?? r.text?.content ?? '').join('')}\n\`\`\``);
        break;
      }
      case 'equation': parts.push(`$$\n${data.expression}\n$$`); break;
      case 'divider': parts.push('---'); break;
      case 'image':
        if (data.type === 'external') parts.push(`![${richToMd(data.caption)}](${data.external.url})`);
        else { lossy.push('uploaded image'); parts.push(`%% Notion-only image %%`); }
        break;
      default:
        lossy.push(b.type);
        parts.push(`%% Notion-only ${b.type} %%`);
    }
  });

  const listKind = (t) => {
    const m = t.match(/^\s*(\d+\.|[-*+] \[[ xX]\]|[-*+])\s/);
    if (!m) return null;
    return /\d/.test(m[1]) ? 'ordered' : m[1].includes('[') ? 'task' : 'bullet';
  };
  const md = parts.reduce((all, part, i) => {
    if (!i) return part;
    const kind = listKind(part);
    return all + (kind && kind === listKind(parts[i - 1]) ? '\n' : '\n\n') + part;
  }, '');
  return { md, lossy: [...new Set(lossy)] };
}
