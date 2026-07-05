import fs from 'node:fs/promises';
import path from 'node:path';
import {
  copyAsset,
  isDataUrl,
  isImagePath,
  isRemoteUrl,
  listMarkdownFiles,
  mergeFrontmatter,
  normalizeDate,
  parseFrontmatter,
  projectRoot,
  readText,
  resolveProjectPath,
  safeFileName,
  slugify,
  stringifyPost,
  stripFileExtension,
  titleFromMarkdown,
  toPublicAssetUrl,
  writeText,
} from './shared.mjs';

export async function runObsidianImport(config, args) {
  const options = parseArgs(args);
  const input = options.source || options._[0] || config.obsidian.vaultDir;

  if (!input) {
    throw new Error('Missing source. Use: npm run content:obsidian -- <note-or-folder>');
  }

  const sourcePath = path.resolve(projectRoot, input);
  const files = await listMarkdownFiles(sourcePath);
  if (files.length === 0) {
    throw new Error(`No Markdown files found at ${sourcePath}`);
  }

  const results = [];
  for (const file of files) {
    results.push(await importObsidianFile(config, file, options));
  }

  return {
    command: 'obsidian',
    dryRun: options.dryRun,
    imported: results.length,
    results,
  };
}

async function importObsidianFile(config, sourceFile, options) {
  const raw = await readText(sourceFile);
  const { frontmatter, body } = parseFrontmatter(raw);
  const title = frontmatter.title || titleFromMarkdown(body, stripFileExtension(path.basename(sourceFile)));
  const pubDate = normalizeDate(frontmatter.pubDate || frontmatter.date || new Date());
  const slug = frontmatter.slug || slugify(`${pubDate}-${title}`, 'note');
  const assetDir = resolveProjectPath(config.assetsDir, slug);
  const postsDir = resolveProjectPath(config.postsDir);
  const outputFile = path.join(postsDir, `${slug}.md`);
  const context = {
    config,
    sourceFile,
    slug,
    assetDir,
    dryRun: options.dryRun,
    assets: [],
  };

  const convertedBody = await convertObsidianMarkdown(body, context);
  const nextFrontmatter = mergeFrontmatter(frontmatter, {
    layout: frontmatter.layout || config.defaultLayout,
    title,
    pubDate,
    description: frontmatter.description || '',
    author: frontmatter.author || config.defaultAuthor,
    tags: normalizeTags(frontmatter.tags),
    source: {
      type: 'obsidian',
      path: path.relative(projectRoot, sourceFile).replace(/\\/g, '/'),
    },
  });

  await writeText(outputFile, stringifyPost({ frontmatter: nextFrontmatter, body: convertedBody }), {
    dryRun: options.dryRun,
  });

  return {
    source: path.relative(projectRoot, sourceFile).replace(/\\/g, '/'),
    output: path.relative(projectRoot, outputFile).replace(/\\/g, '/'),
    slug,
    assets: context.assets,
  };
}

async function convertObsidianMarkdown(body, context) {
  let next = body;

  next = await replaceAsync(next, /!\[\[([^\]]+)\]\]/g, async (_match, target) => {
    const [rawTarget, rawAlt] = target.split('|').map((part) => part.trim());
    const cleanTarget = rawTarget.split('#')[0].trim();
    const asset = await materializeLocalAsset(cleanTarget, context);
    if (!asset) return `![${rawAlt || cleanTarget}](${cleanTarget})`;
    return `![${rawAlt || stripFileExtension(path.basename(cleanTarget))}](${asset})`;
  });

  next = await replaceAsync(next, /!\[([^\]]*)\]\(([^)]+)\)/g, async (match, alt, rawUrl) => {
    const url = rawUrl.trim();
    if (isRemoteUrl(url) || isDataUrl(url) || url.startsWith('/')) return match;
    const asset = await materializeLocalAsset(decodeMarkdownUrl(url), context);
    if (!asset) return match;
    return `![${alt}](${asset})`;
  });

  next = next.replace(/\[\[([^\]]+)\]\]/g, (_match, target) => {
    const [page, alias] = target.split('|').map((part) => part.trim());
    const label = alias || page.split('#').pop() || page;
    if (context.config.obsidian.wikilinks === 'link') {
      return `[${label}](/posts/${slugify(page.split('#')[0], 'note')}/)`;
    }
    return label;
  });

  return next;
}

async function materializeLocalAsset(rawTarget, context) {
  if (!rawTarget || isRemoteUrl(rawTarget) || isDataUrl(rawTarget)) return undefined;
  if (!isImagePath(rawTarget)) return undefined;

  const source = await findLocalAsset(rawTarget, context);
  if (!source) return undefined;

  const fileName = await copyAsset(source, context.assetDir, safeFileName(path.basename(rawTarget)), {
    dryRun: context.dryRun,
  });

  const url = toPublicAssetUrl(context.config, context.slug, fileName);
  context.assets.push({
    source: path.relative(projectRoot, source).replace(/\\/g, '/'),
    url,
  });
  return url;
}

async function findLocalAsset(rawTarget, context) {
  const sourceDir = path.dirname(context.sourceFile);
  const decoded = decodeMarkdownUrl(rawTarget);
  const directCandidates = [
    path.isAbsolute(decoded) ? decoded : path.resolve(sourceDir, decoded),
    ...context.config.obsidian.attachmentDirs.map((dir) => path.resolve(sourceDir, dir, decoded)),
  ];

  if (context.config.obsidian.vaultDir) {
    const vault = path.resolve(projectRoot, context.config.obsidian.vaultDir);
    directCandidates.push(
      path.resolve(vault, decoded),
      ...context.config.obsidian.attachmentDirs.map((dir) => path.resolve(vault, dir, decoded)),
    );
  }

  for (const candidate of unique(directCandidates)) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      // Keep scanning candidates.
    }
  }

  return undefined;
}

function normalizeTags(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value)
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseArgs(args) {
  const options = { _: [], dryRun: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--source') {
      options.source = args[i + 1];
      i += 1;
    } else {
      options._.push(arg);
    }
  }
  return options;
}

function decodeMarkdownUrl(value) {
  return value.replace(/^<|>$/g, '').replace(/%20/g, ' ');
}

function unique(values) {
  return [...new Set(values.map((value) => path.normalize(value)))];
}

async function replaceAsync(source, regex, replacer) {
  const matches = [...source.matchAll(regex)];
  const replacements = await Promise.all(matches.map((match) => replacer(...match)));
  let index = 0;
  return source.replace(regex, () => replacements[index++]);
}
