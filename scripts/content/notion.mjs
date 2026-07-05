import path from 'node:path';
import {
  isRemoteUrl,
  mergeFrontmatter,
  normalizeDate,
  resolveProjectPath,
  safeFileName,
  shortHash,
  slugify,
  stringifyPost,
  toPublicAssetUrl,
  writeBytes,
  writeText,
} from './shared.mjs';

const notionBaseUrl = 'https://api.notion.com/v1';

export async function runNotionSync(config, args) {
  const options = parseArgs(args);
  const notionConfig = {
    ...config.notion,
    token: options.token || config.notion.token,
    dataSourceId: options.dataSource || config.notion.dataSourceId,
  };

  if (!notionConfig.token) {
    throw new Error('Missing NOTION_TOKEN. Put it in .env or pass --token.');
  }

  const pages = options.page
    ? [await requestNotion(notionConfig, 'GET', `/pages/${options.page}`)]
    : await queryPages(notionConfig);

  const publishedPages = options.includeUnpublished
    ? pages
    : pages.filter((page) => isPublished(page, notionConfig));

  const results = [];
  for (const page of publishedPages) {
    results.push(await syncNotionPage(config, notionConfig, page, options));
  }

  return {
    command: 'notion',
    dryRun: options.dryRun,
    fetched: pages.length,
    synced: results.length,
    skipped: pages.length - results.length,
    results,
  };
}

async function queryPages(notionConfig) {
  if (!notionConfig.dataSourceId) {
    throw new Error('Missing NOTION_DATA_SOURCE_ID. Use --data-source or configure content.config.mjs.');
  }

  const pages = [];
  let cursor;

  do {
    const body = {
      page_size: 100,
      ...(notionConfig.filter ? { filter: notionConfig.filter } : {}),
      ...(notionConfig.sorts?.length ? { sorts: notionConfig.sorts } : {}),
      ...(cursor ? { start_cursor: cursor } : {}),
    };
    const response = await requestNotion(
      notionConfig,
      'POST',
      `/data_sources/${notionConfig.dataSourceId}/query`,
      body,
    );
    pages.push(...(response.results || []));
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return pages;
}

async function syncNotionPage(config, notionConfig, page, options) {
  const markdown = await fetchPageMarkdown(notionConfig, page.id);
  const properties = page.properties || {};
  const map = notionConfig.propertyMap;
  const title = getTextProperty(properties, map.title) || findTitle(properties) || 'Untitled';
  const date = getTextProperty(properties, map.date) || page.created_time || new Date();
  const slug = getTextProperty(properties, map.slug) || slugify(`${normalizeDate(date)}-${title}`, 'notion');
  const outputFile = path.join(resolveProjectPath(config.postsDir), `${slug}.md`);
  const body = notionConfig.downloadRemoteImages
    ? await materializeRemoteImages(markdown, config, slug, options)
    : markdown;

  const coverUrl = getCoverUrl(page) || getTextProperty(properties, map.cover);
  const frontmatter = mergeFrontmatter({}, {
    layout: config.defaultLayout,
    title,
    pubDate: normalizeDate(date),
    description: getTextProperty(properties, map.description) || '',
    author: config.defaultAuthor,
    cover: coverUrl ? { url: coverUrl, alt: 'cover' } : undefined,
    tags: getArrayProperty(properties, map.tags),
    theme: getTextProperty(properties, map.theme),
    featured: getBooleanProperty(properties, map.featured),
    source: {
      type: 'notion',
      id: page.id,
      url: page.url,
    },
    notionId: page.id,
    notionUrl: page.url,
    updated: page.last_edited_time,
  });

  await writeText(outputFile, stringifyPost({ frontmatter, body }), {
    dryRun: options.dryRun,
  });

  return {
    title,
    output: path.relative(resolveProjectPath(), outputFile).replace(/\\/g, '/'),
    slug,
    notionId: page.id,
  };
}

async function fetchPageMarkdown(notionConfig, pageId) {
  const payload = await requestNotion(notionConfig, 'GET', `/pages/${pageId}/markdown`);
  if (typeof payload === 'string') return payload;
  if (payload.markdown) return payload.markdown;
  if (payload.content) return payload.content;
  throw new Error(`The Notion markdown endpoint returned no markdown for page ${pageId}.`);
}

async function materializeRemoteImages(markdown, config, slug, options) {
  return replaceAsync(markdown, /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, async (match, alt, url) => {
    if (!isRemoteUrl(url)) return match;

    try {
      const response = await fetch(url);
      if (!response.ok) return match;

      const contentType = response.headers.get('content-type') || '';
      const ext = extensionFromUrlOrType(url, contentType);
      const fileName = safeFileName(`${alt || 'image'}-${shortHash(url)}${ext}`, 'image');
      const outputDir = resolveProjectPath(config.assetsDir, slug);
      await writeBytes(path.join(outputDir, fileName), Buffer.from(await response.arrayBuffer()), {
        dryRun: options.dryRun,
      });

      return `![${alt}](${toPublicAssetUrl(config, slug, fileName)})`;
    } catch {
      return match;
    }
  });
}

async function requestNotion(notionConfig, method, endpoint, body) {
  const response = await fetch(`${notionBaseUrl}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${notionConfig.token}`,
      'Notion-Version': notionConfig.version,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const message = payload?.message || response.statusText;
    throw new Error(`Notion API ${response.status}: ${message}`);
  }

  return payload;
}

function isPublished(page, notionConfig) {
  const propertyName = notionConfig.propertyMap.status;
  if (!propertyName) return true;

  const value = getTextProperty(page.properties || {}, propertyName);
  if (!value) return true;
  return value === notionConfig.publishStatus;
}

function getTextProperty(properties, name) {
  if (!name || !properties[name]) return undefined;
  return propToValue(properties[name]);
}

function getArrayProperty(properties, name) {
  const value = getTextProperty(properties, name);
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function getBooleanProperty(properties, name) {
  const value = getTextProperty(properties, name);
  return typeof value === 'boolean' ? value : undefined;
}

function findTitle(properties) {
  const titleProperty = Object.values(properties).find((property) => property.type === 'title');
  return titleProperty ? propToValue(titleProperty) : undefined;
}

function propToValue(property) {
  switch (property.type) {
    case 'title':
      return richTextToPlain(property.title);
    case 'rich_text':
      return richTextToPlain(property.rich_text);
    case 'select':
      return property.select?.name;
    case 'status':
      return property.status?.name;
    case 'multi_select':
      return property.multi_select?.map((item) => item.name).filter(Boolean) || [];
    case 'date':
      return property.date?.start;
    case 'checkbox':
      return property.checkbox;
    case 'url':
      return property.url;
    case 'email':
      return property.email;
    case 'phone_number':
      return property.phone_number;
    case 'number':
      return property.number;
    case 'files':
      return property.files?.map(fileToUrl).filter(Boolean)[0];
    default:
      return undefined;
  }
}

function richTextToPlain(items = []) {
  return items.map((item) => item.plain_text || '').join('').trim();
}

function getCoverUrl(page) {
  return fileToUrl(page.cover);
}

function fileToUrl(file) {
  if (!file) return undefined;
  if (file.type === 'external') return file.external?.url;
  if (file.type === 'file') return file.file?.url;
  return undefined;
}

function extensionFromUrlOrType(url, contentType) {
  const parsedExt = path.extname(new URL(url).pathname).toLowerCase();
  if (parsedExt && parsedExt.length <= 6) return parsedExt;
  if (contentType.includes('png')) return '.png';
  if (contentType.includes('webp')) return '.webp';
  if (contentType.includes('gif')) return '.gif';
  if (contentType.includes('svg')) return '.svg';
  return '.jpg';
}

function parseArgs(args) {
  const options = { dryRun: false, includeUnpublished: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--include-unpublished') {
      options.includeUnpublished = true;
    } else if (arg === '--page') {
      options.page = args[i + 1];
      i += 1;
    } else if (arg === '--data-source') {
      options.dataSource = args[i + 1];
      i += 1;
    } else if (arg === '--token') {
      options.token = args[i + 1];
      i += 1;
    }
  }
  return options;
}

async function replaceAsync(source, regex, replacer) {
  const matches = [...source.matchAll(regex)];
  const replacements = await Promise.all(matches.map((match) => replacer(...match)));
  let index = 0;
  return source.replace(regex, () => replacements[index++]);
}
