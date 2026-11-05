# Under the Rind

A personal site built with Astro. Notes come from Obsidian, the site deploys to Cloudflare, and Weekly is password-protected.

## Run it on your computer

```powershell
npm install
npm test
npm run dev
```

Open http://localhost:4321. Weekly appears without a password in `npm run dev`, because only the real build encrypts it.

To test the real build:

```powershell
$env:WEEKLY_PASSWORD = "choose-a-long-password"
npm run build
npm run preview
```

## Publish notes

Add these fields to an Obsidian note:

```yaml
---
publish: true
title: My note
type: writing   # writing, reflection, reading, travel, or weekly
date: 2026-11-04
summary: Optional one-liner
---
```

Other optional fields: `tags`, `aliases`, `slug`. Reading notes also need `author`, and can have `rating`. Travel notes can have `place`.

```powershell
npm run notes -- --vault "C:\path\to\vault"           # preview
npm run notes -- --vault "C:\path\to\vault" --write   # replace everything in src/content/notes
git add .
git commit -m "Update notes"
git push
```

`--write` replaces the sample notes. Only the fields above are copied, and `%%comments%%` are removed. Publishing stops if a public note links to a Weekly report.

Publishing also creates link preview images in `public/og`. Commit that folder with your notes.

## Margin notes

Put a margin callout just before the paragraph it belongs to:

```markdown
> [!margin] This appears beside the next paragraph.

The paragraph goes here.
```

It sits in the margin on wide screens and inside the text on phones. `> [!under]` creates a "Look under the rind" fold-out.

## Sync with Notion

Sync connects **one Notion database** to **one vault folder** (`Notion` by default). It doesn't touch the rest of your vault.

Setup:

1. Create an internal integration at https://www.notion.so/my-integrations and copy its token.
2. Open your database in Notion and connect the integration to it from the page's connections menu.
3. Copy the database ID from its URL. If you already have Notion pages elsewhere, move them into this database.
4. Add a `.env` file to this project. It's ignored by Git. Never commit it.

```
NOTION_TOKEN=your-token
NOTION_DATABASE_ID=your-database-id
VAULT_PATH=C:\path\to\vault
```

Optional database properties, matched by name: `Date` (date), `Type` (select), `Publish` (checkbox), `Summary` (text), `Tags` (multi-select). The `Type` values should be the site's lowercase types, such as `writing`.

```powershell
npm run notion             # preview
npm run notion -- --write  # apply
```

How it behaves:

- A note edited on one side updates the other.
- New pages arrive with `publish: false` unless `Publish` is ticked.
- If both sides changed, neither is overwritten. The Notion version is saved as `Name.conflict.md`, which is never published. Combine them yourself, or run with `--resolve local` or `--resolve notion`, which applies to every conflict in that run.
- Deleting on one side never deletes on the other. Sync reports it instead.
- Pages with content Markdown can't hold (tables, databases, toggles, uploaded files, and similar) are pulled with a placeholder, but your vault edits won't be pushed over them. Edit those pages in Notion.
- Notion's edit time is only precise to the minute, so an edit made in the same minute as a sync can be missed until that page changes again.

Run `npm run notion -- --write` first, then `npm run notes`, so Notion changes reach the site.

## Deploy

1. Push this folder to a **private** GitHub repository.
2. In Cloudflare, create a Pages project connected to that repository.
3. Use build command `npm run build` and output folder `dist`.
4. Add an encrypted environment variable named `WEEKLY_PASSWORD`.
5. After the first deploy, put the real address in `site.config.mjs`.

## Weekly security

Reports are encrypted in the browser page with AES-GCM and a key derived from your password. The build fails if the password is missing or report text appears anywhere else in the output. Use a long password. Someone who saved the encrypted page can still open that copy with an old password, and images hosted on S3 stay reachable by direct link.

## Edit

- Site name, address, and image host: `site.config.mjs`
- About page: `src/pages/about.astro`
- Homepage intro: `src/pages/index.astro`
- Colors and type: `src/styles/global.css`
