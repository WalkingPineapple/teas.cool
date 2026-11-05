import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import site from './site.config.mjs';
import remarkObsidian from './src/lib/remark-obsidian.mjs';

export default defineConfig({
  site: site.url,
  trailingSlash: 'always',
  integrations: [sitemap({ filter: (page) => !page.includes('/weekly') })],
  markdown: {
    remarkPlugins: [remarkMath, remarkObsidian],
    rehypePlugins: [rehypeKatex],
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' } },
  },
});
