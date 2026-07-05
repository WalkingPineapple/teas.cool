import path from 'node:path';
import {
  isRemoteUrl,
  listMarkdownFiles,
  parseFrontmatter,
  pathExists,
  readText,
  resolveProjectPath,
} from './shared.mjs';

export async function runDoctor(config) {
  const postsDir = resolveProjectPath(config.postsDir);
  const files = await listMarkdownFiles(postsDir);
  const issues = [];

  for (const file of files) {
    const raw = await readText(file);
    const { frontmatter, body } = parseFrontmatter(raw);
    const relative = path.relative(resolveProjectPath(), file).replace(/\\/g, '/');

    for (const field of ['layout', 'title', 'pubDate']) {
      if (!frontmatter[field]) {
        issues.push({
          file: relative,
          type: 'frontmatter',
          message: `Missing ${field}`,
        });
      }
    }

    if (/!\[\[[^\]]+\]\]/.test(body)) {
      issues.push({
        file: relative,
        type: 'obsidian',
        message: 'Contains Obsidian image embeds. Run content:obsidian to normalize them.',
      });
    }

    for (const match of body.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
      const url = match[1].trim().replace(/^<|>$/g, '');
      if (!url || isRemoteUrl(url) || url.startsWith('#') || url.startsWith('data:')) continue;
      if (!url.startsWith('/')) continue;

      const localPath = resolveProjectPath('public', url.replace(/^\//, ''));
      if (!(await pathExists(localPath))) {
        issues.push({
          file: relative,
          type: 'asset',
          message: `Missing local asset ${url}`,
        });
      }
    }
  }

  return {
    command: 'doctor',
    checked: files.length,
    issues,
  };
}
