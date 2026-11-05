import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { visit } from 'unist-util-visit';
import site from './site.config.mjs';
import remarkObsidian from './src/lib/remark-obsidian.mjs';

// 正文图片懒加载：视口外的图片不再抢首屏带宽
function rehypeLazyImages() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'img' || node.properties.loading) return;
      node.properties.loading = 'lazy';
      node.properties.decoding = 'async';
    });
  };
}

export default defineConfig({
  site: site.url,
  trailingSlash: 'always',
  integrations: [sitemap({ filter: (page) => !page.includes('/weekly') })],
  markdown: {
    remarkPlugins: [remarkMath, remarkObsidian],
    rehypePlugins: [rehypeKatex, rehypeLazyImages],
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' } },
  },
});
