export default {
  postsDir: 'src/pages/posts',
  assetsDir: 'public/uploads/posts',
  publicAssetsBaseUrl: '/uploads/posts',
  defaultLayout: '../../layouts/MarkdownPost.astro',
  defaultAuthor: 'P1neapple',

  obsidian: {
    vaultDir: process.env.OBSIDIAN_VAULT_DIR || '',
    attachmentDirs: ['.', 'assets', 'attachments', '_assets', 'Files', 'images'],
    wikilinks: 'text',
  },

  notion: {
    token: process.env.NOTION_TOKEN || process.env.NOTION_API_KEY || '',
    dataSourceId: process.env.NOTION_DATA_SOURCE_ID || '',
    version: '2026-03-11',
    publishStatus: process.env.NOTION_PUBLISH_STATUS || 'Published',
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
    sorts: [
      {
        property: 'Date',
        direction: 'descending',
      },
    ],
  },
};
