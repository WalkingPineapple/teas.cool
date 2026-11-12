import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

export const norm = (s) => String(s).trim().replace(/\.md$/i, '').toLowerCase();

export function urlFor(type, slug) {
  if (type === 'weekly') return `/weekly/#${slug}`;
  const section = type === 'reflection' ? 'writing' : type === 'story' ? 'stories' : type;
  return `/${section}/${slug}/`;
}

/**
 * A sortable number for when a story happened: the first year (and month, if given) found in `when`.
 * "2014" , "Summer 2019", "2014-2016" and "2014-06" all work. Without a year, the written date is used.
 */
export function whenKey(when, fallback) {
  const m = String(when ?? '').match(/(\d{4})(?:[-/.](\d{1,2})(?!\d))?/);
  if (m) return Number(m[1]) * 12 + (m[2] ? Math.min(12, Math.max(1, Number(m[2]))) - 1 : 0);
  const d = new Date(fallback);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/** Map every name a note can be linked by to that note. */
export function buildIndex(dir = path.resolve(process.cwd(), 'src/content/notes')) {
  const byName = new Map();
  const bySlug = new Map();
  if (!fs.existsSync(dir)) return { byName, bySlug };
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.md')) continue;
    const slug = file.slice(0, -3);
    const { data } = matter(fs.readFileSync(path.join(dir, file), 'utf8'));
    const note = { slug, title: data.title ?? slug, type: data.type, url: urlFor(data.type, slug) };
    bySlug.set(slug, note);
    for (const name of [slug, data.title, data.source, ...(data.aliases ?? [])]) {
      if (name) byName.set(norm(name), note);
    }
  }
  return { byName, bySlug };
}

const WIKILINK = /\[\[([^\]|#]+)/g;

/** Names linked from a Markdown body, ignoring code. */
export function linkedNames(body) {
  const clean = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  return [...clean.matchAll(WIKILINK)].map((m) => norm(m[1]));
}
