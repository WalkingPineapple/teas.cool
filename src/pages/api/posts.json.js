export async function get() {
  const posts = Object.values(import.meta.glob('../posts/*.md', { eager: true }));

  const searchData = posts
    .sort((a, b) => new Date(b.frontmatter.pubDate).getTime() - new Date(a.frontmatter.pubDate).getTime())
    .map(post => {
      const html = typeof post.compiledContent === 'function' ? post.compiledContent() : '';
      const text = html.replace(/<[^>]*>/g, '');

      return {
        title: post.frontmatter.title,
        description: post.frontmatter.description || '',
        date: post.frontmatter.pubDate,
        url: post.url,
        tags: post.frontmatter.tags || [],
        excerpt: text.slice(0, 200),
        content: text.slice(0, 1000)
      };
    });

  return new Response(JSON.stringify(searchData), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}
