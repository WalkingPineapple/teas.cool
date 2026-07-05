# Content Adapters

这个项目的内容层仍然以本地 Markdown 为最终产物。Obsidian 和 Notion 都先同步到 `src/pages/posts`，再由 Astro 静态构建。

## Commands

```bash
npm run content:doctor
npm run content:obsidian -- "C:/path/to/note.md"
npm run content:obsidian -- "C:/path/to/vault/folder" -- --dry-run
npm run content:notion -- --page "<notion-page-id>"
npm run content:notion -- --data-source "<notion-data-source-id>"
```

## Obsidian

Obsidian adapter 会做三件事：

1. 读取单个 Markdown 文件或整个目录。
2. 把 `![[image.png]]` 和相对图片引用复制到 `public/uploads/posts/<slug>/`。
3. 把结果写成 Astro 当前可直接渲染的 Markdown。

默认会在当前笔记目录、`assets`、`attachments`、`_assets`、`Files`、`images` 里找图片。可以在 `content.config.mjs` 里改：

```js
obsidian: {
  vaultDir: process.env.OBSIDIAN_VAULT_DIR || '',
  attachmentDirs: ['.', 'assets', 'attachments', '_assets', 'Files', 'images'],
  wikilinks: 'text',
}
```

第一版先把图片落到站内静态资源。后面如果要接图床，可以在这个 adapter 后面加上传 provider，把本地复制步骤替换成上传后返回 URL。

## Notion

Notion adapter 会用 API 把页面同步成本地 Markdown：

1. `--page` 同步单个页面。
2. `--data-source` 批量同步一个 data source 里的页面。
3. 默认只同步 `Status = Published` 的页面。
4. 默认会下载 Markdown 里的远程图片到 `public/uploads/posts/<slug>/`，避免 Notion 文件链接过期。

需要准备 `.env`：

```bash
NOTION_TOKEN=secret_xxx
NOTION_DATA_SOURCE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
NOTION_PUBLISH_STATUS=Published
```

如果你的 Notion 属性名不是默认值，改 `content.config.mjs`：

```js
notion: {
  propertyMap: {
    title: 'Name',
    slug: 'Slug',
    date: 'Date',
    description: 'Description',
    status: 'Status',
    tags: 'Tags',
    cover: 'Cover',
  },
}
```

## Why Local Markdown

本地 Markdown 是这套链路的中心：

1. 构建速度稳定，页面不依赖运行时 API。
2. 内容能进 Git，回滚和审查都清楚。
3. Notion token 留在本机或 CI，不会暴露给前端。
4. Obsidian 和 Notion 可以同时存在，不必一次性迁移。
