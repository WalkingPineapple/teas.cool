import rss from '@astrojs/rss';
import { SITE_DESCRIPTION, SITE_TITLE, SITE_URL } from '../consts';

export async function get() {
  const posts = Object.values(import.meta.glob('./posts/*.md', { eager: true }))
    .sort((a, b) => new Date(b.frontmatter.pubDate).getTime() - new Date(a.frontmatter.pubDate).getTime());

  return rss({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    site: SITE_URL,
    items: posts.map((post) => ({
      title: post.frontmatter.title,
      description: post.frontmatter.description,
      pubDate: post.frontmatter.pubDate,
      link: post.url,
      author: post.frontmatter.author,
    })),
    customData: `<language>zh-cn</language>`,
  });
}
