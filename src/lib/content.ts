import { getCollection } from 'astro:content';
import { linkedNames, norm, urlFor, whenKey } from './notes-index.mjs';

const newest = (a: any, b: any) => b.data.date.valueOf() - a.data.date.valueOf();

export const noteUrl = (n: any) => urlFor(n.data.type, n.id);

export async function publicNotes() {
  return (await getCollection('notes', ({ data }) => data.type !== 'weekly')).sort(newest);
}

export async function weeklyNotes() {
  return (await getCollection('notes', ({ data }) => data.type === 'weekly')).sort(newest);
}

export const ofType = async (...types: string[]) =>
  (await publicNotes()).filter((n) => types.includes(n.data.type));

/** 故事按发生先后排序，最早在前；同期的按写作时间先后。 */
export async function stories() {
  const key = (n: any) => whenKey(n.data.when, n.data.date);
  return (await ofType('story')).sort((a, b) => key(a) - key(b) || a.data.date.valueOf() - b.data.date.valueOf());
}

export const typeLabel: Record<string, string> = {
  writing: '写作', reflection: '随想', story: '故事', reading: '读书', travel: '旅行', weekly: '周报',
};

export const formatDate = (d: Date) =>
  `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;

export const readingTime = (body = '') =>
  Math.max(1, Math.round(body.trim().split(/\s+/).length / 220));

/** 标签转 URL：英文转小写连字符，非英文字母保留 */
export const tagSlug = (tag: string) =>
  String(tag).trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');

export const tagUrl = (tag: string) => `/tags/${tagSlug(tag)}/`;

export async function backlinks(note: any) {
  const names = new Set(
    [note.id, note.data.title, note.data.source, ...note.data.aliases].filter(Boolean).map(norm),
  );
  return (await publicNotes()).filter(
    (n) => n.id !== note.id && linkedNames(n.body ?? '').some((name) => names.has(name)),
  );
}
