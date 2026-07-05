import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const projectRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

const imageExtensions = new Set([
  '.avif',
  '.bmp',
  '.gif',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.webp',
]);

export async function loadConfig() {
  await loadDotEnv();
  const configPath = path.join(projectRoot, 'content.config.mjs');
  const userConfig = (await import(`${pathToFileURL(configPath).href}?t=${Date.now()}`)).default || {};

  return {
    postsDir: 'src/pages/posts',
    assetsDir: 'public/uploads/posts',
    publicAssetsBaseUrl: '/uploads/posts',
    defaultLayout: '../../layouts/MarkdownPost.astro',
    defaultAuthor: 'P1neapple',
    ...userConfig,
    obsidian: {
      vaultDir: '',
      attachmentDirs: ['.', 'assets', 'attachments', '_assets', 'Files', 'images'],
      wikilinks: 'text',
      ...(userConfig.obsidian || {}),
    },
    notion: {
      token: '',
      dataSourceId: '',
      version: '2026-03-11',
      publishStatus: 'Published',
      includeTranscript: false,
      downloadRemoteImages: true,
      propertyMap: {
        title: 'Name',
        slug: 'Slug',
        date: 'Date',
        description: 'Description',
        status: 'Status',
        tags: 'Tags',
        cover: 'Cover',
        featured: 'Featured',
        theme: 'Theme',
      },
      filter: undefined,
      sorts: [],
      ...(userConfig.notion || {}),
      propertyMap: {
        title: 'Name',
        slug: 'Slug',
        date: 'Date',
        description: 'Description',
        status: 'Status',
        tags: 'Tags',
        cover: 'Cover',
        featured: 'Featured',
        theme: 'Theme',
        ...((userConfig.notion || {}).propertyMap || {}),
      },
    },
  };
}

async function loadDotEnv() {
  const envPath = path.join(projectRoot, '.env');
  if (!(await pathExists(envPath))) return;

  const content = await fs.readFile(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const index = trimmed.indexOf('=');
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    const rawValue = trimmed.slice(index + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }
}

export function resolveProjectPath(...parts) {
  return path.resolve(projectRoot, ...parts);
}

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function pathExists(target) {
  try {
    await fs.access(target, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readText(file) {
  return fs.readFile(file, 'utf8');
}

export async function writeText(file, content, { dryRun = false } = {}) {
  if (dryRun) return;
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, content, 'utf8');
}

export async function writeBytes(file, bytes, { dryRun = false } = {}) {
  if (dryRun) return;
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, bytes);
}

export function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { frontmatter: {}, body: markdown };

  return {
    frontmatter: parseYamlLite(match[1]),
    body: markdown.slice(match[0].length),
  };
}

export function stringifyPost({ frontmatter, body }) {
  return `---\n${stringifyYamlLite(frontmatter)}---\n\n${body.trimStart()}`;
}

export function normalizeDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return normalizeDate(new Date());
  return date.toISOString().slice(0, 10);
}

export function stripFileExtension(fileName) {
  return fileName.replace(/\.[^.]+$/, '');
}

export function slugify(value, fallback = 'post') {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);

  if (normalized) return normalized;
  return `${fallback}-${shortHash(value || fallback)}`;
}

export function safeFileName(value, fallback = 'asset') {
  const parsed = path.parse(value || fallback);
  const base = slugify(parsed.name, fallback);
  const ext = parsed.ext.toLowerCase();
  return `${base}${ext}`;
}

export function shortHash(value) {
  return createHash('sha1').update(String(value)).digest('hex').slice(0, 8);
}

export function titleFromMarkdown(body, fallback) {
  const heading = body.match(/^#\s+(.+)$/m);
  return (heading?.[1] || fallback || 'Untitled').trim();
}

export function isRemoteUrl(value) {
  return /^https?:\/\//i.test(value || '');
}

export function isDataUrl(value) {
  return /^data:/i.test(value || '');
}

export function isImagePath(value) {
  return imageExtensions.has(path.extname(value.split('?')[0]).toLowerCase());
}

export function toPublicAssetUrl(config, slug, fileName) {
  return `${config.publicAssetsBaseUrl.replace(/\/$/, '')}/${slug}/${encodeURIComponent(fileName)}`;
}

export async function listMarkdownFiles(target) {
  const resolved = path.resolve(target);
  const stat = await fs.stat(resolved);
  if (stat.isFile()) return [resolved];
  if (!stat.isDirectory()) return [];

  const entries = await fs.readdir(resolved, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const child = path.join(resolved, entry.name);
    if (entry.isDirectory()) return listMarkdownFiles(child);
    return child.toLowerCase().endsWith('.md') ? [child] : [];
  }));

  return files.flat();
}

export async function copyAsset(source, destinationDir, preferredName, { dryRun = false } = {}) {
  const fileName = safeFileName(preferredName || path.basename(source), 'asset');
  let destination = path.join(destinationDir, fileName);

  if (await pathExists(destination)) {
    const parsed = path.parse(fileName);
    destination = path.join(destinationDir, `${parsed.name}-${shortHash(source)}${parsed.ext}`);
  }

  if (!dryRun) {
    await ensureDir(destinationDir);
    await fs.copyFile(source, destination);
  }

  return path.basename(destination);
}

export function mergeFrontmatter(base, override) {
  const merged = { ...base, ...override };
  Object.keys(merged).forEach((key) => {
    if (merged[key] === undefined || merged[key] === null || merged[key] === '') {
      delete merged[key];
    }
  });
  return merged;
}

function parseYamlLite(source) {
  const data = {};
  const lines = source.split(/\r?\n/);
  let currentObjectKey = null;

  for (const line of lines) {
    if (!line.trim()) continue;

    const childMatch = line.match(/^\s{2,}([A-Za-z0-9_-]+):\s*(.*)$/);
    if (childMatch && currentObjectKey) {
      data[currentObjectKey][childMatch[1]] = parseScalar(childMatch[2]);
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (!rawValue.trim()) {
      data[key] = {};
      currentObjectKey = key;
      continue;
    }

    currentObjectKey = null;
    data[key] = parseScalar(rawValue);
  }

  return data;
}

function parseScalar(value) {
  const raw = value.trim();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (/^\[.*\]$/.test(raw)) {
    return raw
      .slice(1, -1)
      .split(',')
      .map((item) => parseScalar(item))
      .filter((item) => item !== '');
  }
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  return raw;
}

function stringifyYamlLite(data) {
  const preferredOrder = [
    'layout',
    'title',
    'pubDate',
    'description',
    'author',
    'cover',
    'tags',
    'theme',
    'featured',
    'source',
    'notionId',
    'notionUrl',
    'updated',
  ];

  const keys = [
    ...preferredOrder.filter((key) => Object.prototype.hasOwnProperty.call(data, key)),
    ...Object.keys(data).filter((key) => !preferredOrder.includes(key)),
  ];

  return keys.map((key) => formatYamlEntry(key, data[key])).join('');
}

function formatYamlEntry(key, value, indent = '') {
  if (Array.isArray(value)) {
    return `${indent}${key}: [${value.map(formatInlineValue).join(', ')}]\n`;
  }

  if (value && typeof value === 'object') {
    const children = Object.entries(value)
      .filter(([, childValue]) => childValue !== undefined && childValue !== null && childValue !== '')
      .map(([childKey, childValue]) => formatYamlEntry(childKey, childValue, `${indent}  `))
      .join('');
    return children ? `${indent}${key}:\n${children}` : '';
  }

  return `${indent}${key}: ${formatInlineValue(value)}\n`;
}

function formatInlineValue(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (value === null || value === undefined) return "''";
  return `'${String(value).replace(/'/g, "''")}'`;
}
