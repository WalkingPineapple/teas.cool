import { getCollection } from 'astro:content';
import { linkedNames, norm } from './notes-index.mjs';

const newest = (a: any, b: any) => b.data.date.valueOf() - a.data.date.valueOf();

export const noteUrl = (n: any) => {
  const section = n.data.type === 'reflection' ? 'writing' : n.data.type;
  return `/${section}/${n.id}/`;
};

export async function publicNotes() {
  return (await getCollection('notes', ({ data }) => data.type !== 'weekly')).sort(newest);
}

export async function weeklyNotes() {
  return (await getCollection('notes', ({ data }) => data.type === 'weekly')).sort(newest);
}

export const ofType = async (...types: string[]) =>
  (await publicNotes()).filter((n) => types.includes(n.data.type));

export const typeLabel: Record<string, string> = {
  writing: '写作', reflection: '随想', reading: '读书', travel: '旅行', weekly: '周报',
};

export const formatDate = (d: Date) =>
  `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;

export const readingTime = (body = '') =>
  Math.max(1, Math.round(body.trim().split(/\s+/).length / 220));

export async function backlinks(note: any) {
  const names = new Set(
    [note.id, note.data.title, note.data.source, ...note.data.aliases].filter(Boolean).map(norm),
  );
  return (await publicNotes()).filter(
    (n) => n.id !== note.id && linkedNames(n.body ?? '').some((name) => names.has(name)),
  );
}
