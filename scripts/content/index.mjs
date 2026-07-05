import { runDoctor } from './doctor.mjs';
import { runNotionSync } from './notion.mjs';
import { runObsidianImport } from './obsidian.mjs';
import { loadConfig } from './shared.mjs';

const help = `Content tools

Usage:
  npm run content:doctor
  npm run content:obsidian -- <note-or-folder> [--dry-run]
  npm run content:notion -- [--page <page-id>] [--data-source <id>] [--dry-run]

Commands:
  doctor      Check local Markdown frontmatter and local image references.
  obsidian    Import Obsidian Markdown and materialize local images.
  notion      Sync Notion pages to local Markdown.
`;

async function main() {
  const [command = 'help', ...args] = process.argv.slice(2);
  const config = await loadConfig();

  let result;
  if (command === 'doctor') {
    result = await runDoctor(config, args);
  } else if (command === 'obsidian') {
    result = await runObsidianImport(config, args);
  } else if (command === 'notion') {
    result = await runNotionSync(config, args);
  } else {
    process.stdout.write(help);
    return;
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
