// Creates 1200x630 link preview images for public notes. Weekly never gets one.
import fs from 'node:fs';
import path from 'node:path';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const wide = (c) => (/[⺀-￯]/.test(c) ? 2 : 1);
const width = (s) => [...s].reduce((sum, c) => sum + wide(c), 0);

export function wrap(title, max = 25, lines = 4) {
  const words = String(title).split(/(\s+)/).filter((w) => w.trim());
  const out = [];
  let line = '';
  const push = () => { if (line) out.push(line); line = ''; };
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (width(candidate) <= max) { line = candidate; continue; }
    push();
    let piece = '';
    for (const c of word) {
      if (width(piece + c) > max) { out.push(piece); piece = ''; }
      piece += c;
    }
    line = piece;
  }
  push();
  if (out.length <= lines) return out;
  const kept = out.slice(0, lines);
  kept[lines - 1] = `${[...kept[lines - 1]].slice(0, -1).join('').trimEnd()}…`;
  return kept;
}

export function svgFor({ title, label }) {
  const lines = wrap(title);
  const size = lines.length > 3 ? 62 : 74;
  const lineHeight = size * 1.12;
  const startY = 330 - ((lines.length - 1) * lineHeight) / 2;
  const text = lines.map((l, i) => `<text x="80" y="${startY + i * lineHeight}" font-size="${size}" fill="#F7F2DF">${esc(l)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <pattern id="lattice" width="60" height="60" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0H60M0 0V60" stroke="#F2CF6B" stroke-opacity=".1" stroke-width="1.5" fill="none"/></pattern>
    <clipPath id="body"><ellipse cx="20" cy="34" rx="14" ry="18"/></clipPath>
  </defs>
  <rect width="1200" height="630" fill="#21372F"/><rect width="1200" height="630" fill="url(#lattice)"/>
  <g font-family="Newsreader, Georgia, 'Noto Serif CJK SC', 'Microsoft YaHei', 'DejaVu Serif', serif">
    <text x="80" y="104" font-size="28" fill="#F2CF6B" letter-spacing="1">${esc(label)}</text>
    ${text}
    <text x="80" y="550" font-size="34" font-style="italic" fill="#F7F2DF">Under the Rind</text>
  </g>
  <g transform="translate(980 372) scale(3.4)">
    <path fill="#8FC7A0" d="M20 18C16 12 16 6 20 1C24 6 24 12 20 18ZM19 18C13 16 9 11 8 5C13 7 17 11 19 18ZM21 18C27 16 31 11 32 5C27 7 23 11 21 18Z"/>
    <ellipse cx="20" cy="34" rx="14" ry="18" fill="#C69A3D"/>
    <path clip-path="url(#body)" stroke="#7A5209" stroke-width="1.5" fill="none" d="M0 22L40 58M0 34L32 62M8 12L44 46M20 10L46 34M40 22L0 58M40 34L8 62M32 12L-4 46M20 10L-6 34"/>
    <path fill="#F3DFA2" d="M34 34C27 37 20 43 16 51.6C26 53.6 34.5 45 34 34Z"/>
  </g>
</svg>`;
}

const LABELS = { writing: '写作', reflection: '随想', reading: '读书', travel: '旅行' };

export async function generateImages(notes, dir) {
  let sharp;
  try {
    ({ default: sharp } = await import('sharp'));
  } catch (e) {
    return { ok: false, count: 0, reason: e.message };
  }
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(dir)) if (name.endsWith('.png')) fs.rmSync(path.join(dir, name));

  const render = (data, name) => sharp(Buffer.from(svgFor(data))).png().toFile(path.join(dir, name));
  await render({ title: '对万物运作方式保持好奇。', label: '笔记 · 读书 · 旅行' }, 'default.png');
  const shared = notes.filter((n) => n.front.type !== 'weekly');
  for (const n of shared) await render({ title: n.front.title, label: LABELS[n.front.type] }, `${n.slug}.png`);
  return { ok: true, count: shared.length + 1 };
}
