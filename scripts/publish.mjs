#!/usr/bin/env node
// Copies Obsidian notes marked `publish: true` into src/content/notes.
//   npm run notes -- --vault "C:\path\to\vault"        preview only
//   npm run notes -- --vault "C:\path\to\vault" --write   replace the site's notes
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { generateImages } from './og.mjs';

const TYPES = new Set(['writing', 'reflection', 'reading', 'travel', 'weekly']);
const FIELDS = ['title', 'type', 'date', 'summary', 'tags', 'aliases', 'author', 'rating', 'place'];
const SKIP_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules']);
const norm = (s) => String(s).trim().replace(/\.md$/i, '').toLowerCase();

export const slugify = (s) =>
  s.normalize('NFKC').toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');

// Removes Obsidian %% comments, leaving code untouched.
export const stripComments = (body) =>
  body.split(/(```[\s\S]*?```|`[^`\n]*`)/g).map((part, i) => (i % 2 ? part : part.replace(/%%[\s\S]*?%%/g, ''))).join('');

const removeCode = (body) => body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
const wikiTargets = (body) => [...removeCode(body).matchAll(/!?\[\[([^\]|#]+)/g)].map((m) => norm(m[1]));
const mdTargets = (body) =>
  [...removeCode(body).matchAll(/\]\(([^)\s]+\.md)(?:#[^)]*)?\)/gi)].map((m) => norm(path.basename(decodeURI(m[1]))));

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(path.join(dir, entry.name));
    } else if (entry.name.toLowerCase().endsWith('.md')) {
      yield path.join(dir, entry.name);
    }
  }
}

export function collect(vault) {
  const notes = [];
  const errors = [];
  const slugs = new Map();
  let scanned = 0;

  for (const file of walk(vault)) {
    scanned += 1;
    const rel = path.relative(vault, file);
    let parsed;
    try {
      parsed = matter(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      // A broken note can't prove it's public, so skip it unless it visibly opts in.
      if (/^publish:\s*true\s*$/m.test(fs.readFileSync(file, 'utf8'))) errors.push(`${rel}: invalid frontmatter (${e.reason ?? e.message})`);
      continue;
    }
    const { data, content } = parsed;
    if (data.publish !== true) continue;

    const source = path.basename(file, path.extname(file));
    const problems = [];
    if (!data.title) problems.push('missing title');
    if (!TYPES.has(data.type)) problems.push(`type must be one of ${[...TYPES].join(', ')}`);
    if (!data.date || Number.isNaN(new Date(data.date).valueOf())) problems.push('missing or invalid date');
    if (data.type === 'reading' && !data.author) problems.push('reading notes need an author');
    if (problems.length) { errors.push(`${rel}: ${problems.join('; ')}`); continue; }

    const slug = slugify(String(data.slug ?? source));
    if (!slug) { errors.push(`${rel}: can't make a URL from the file name; add a slug field`); continue; }
    if (slugs.has(slug)) { errors.push(`${rel}: same URL as ${slugs.get(slug)}; add a slug field`); continue; }
    slugs.set(slug, rel);

    const front = { source };
    for (const key of FIELDS) if (data[key] !== undefined) front[key] = data[key];
    notes.push({ rel, slug, front, body: stripComments(content).trim() + '\n' });
  }

  // Public notes must not point at Weekly. Those links would hide, but the author should know.
  const weekly = new Set();
  for (const n of notes) {
    if (n.front.type !== 'weekly') continue;
    for (const name of [n.slug, n.front.source, n.front.title, ...(n.front.aliases ?? [])]) weekly.add(norm(name));
  }
  for (const n of notes) {
    if (n.front.type === 'weekly') continue;
    const hit = [...wikiTargets(n.body), ...mdTargets(n.body)].find((t) => weekly.has(t));
    if (hit) errors.push(`${n.rel}: public note links to Weekly report "${hit}"`);
  }
  return { notes, errors, scanned };
}

export function write(notes, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(dest)) if (name.endsWith('.md')) fs.rmSync(path.join(dest, name));
  for (const n of notes) fs.writeFileSync(path.join(dest, `${n.slug}.md`), matter.stringify(n.body, n.front));
}

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--vault');
  const vault = at >= 0 ? args[at + 1] : process.env.VAULT_PATH;
  if (!vault || !fs.existsSync(vault)) {
    console.error('Tell me where your vault is: npm run notes -- --vault "C:\\path\\to\\vault"');
    process.exit(1);
  }
  const { notes, errors, scanned } = collect(vault);
  console.log(`Scanned ${scanned} notes; ${notes.length} marked publish: true.`);
  for (const n of notes) console.log(`  ${n.front.type.padEnd(10)} ${n.slug}`);
  if (errors.length) {
    console.error(`\nNothing was changed. Fix ${errors.length} problem(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  if (!args.includes('--write')) {
    console.log('\nPreview only. Add --write to replace the notes in src/content/notes.');
    return;
  }
  write(notes, path.resolve(process.cwd(), 'src/content/notes'));
  const images = await generateImages(notes, path.resolve(process.cwd(), 'public/og'));
  console.log(images.ok ? `Created ${images.count} social preview images.` : `Notes saved, but preview images were skipped: ${images.reason}`);
  console.log('\nDone. Review the changes, then commit and push.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
