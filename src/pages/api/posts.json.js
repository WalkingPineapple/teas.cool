// API 端点：获取所有文章用于搜索
export async function GET() {
  const posts = await Astro.glob('../posts/*.md');

  const searchData = posts
    .sort((a, b) => new Date(b.frontmatter.pubDate) - new Date(a.frontmatter.pubDate))
    .map(post => ({
      title: post.frontmatter.title,
      description: post.frontmatter.description || '',
      date: post.frontmatter.pubDate,
      url: post.url,
      tags: post.frontmatter.tags || [],
      excerpt: post.compiledContent().replace(/<[^>]*>/g, '').slice(0, 200),
      content: post.compiledContent().replace(/<[^>]*>/g, '').slice(0, 1000)
    }));

  return new Response(JSON.stringify(searchData), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}