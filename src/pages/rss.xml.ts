import rss from '@astrojs/rss';
import site from '../../site.config.mjs';
import { noteUrl, publicNotes } from '../lib/content';

export async function GET(context: { site?: URL }) {
  const notes = await publicNotes();
  return rss({
    title: site.title,
    description: site.description,
    site: context.site!,
    items: notes.map((n) => ({ title: n.data.title, pubDate: n.data.date, description: n.data.summary, link: noteUrl(n) })),
  });
}
