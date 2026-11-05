#!/usr/bin/env node
// Runs after `astro build`. Encrypts the Weekly page and fails if any report text leaks.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto as crypto } from 'node:crypto';
import matter from 'gray-matter';

const ITERATIONS = 600000;
const SECRET = /<weekly-secret[^>]*>([\s\S]*?)<\/weekly-secret>/;
const b64 = (buf) => Buffer.from(buf).toString('base64');

export async function encrypt(plain, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt'],
  );
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  return { salt: b64(salt), iv: b64(iv), iterations: ITERATIONS, data: b64(data) };
}

function* files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else yield full;
  }
}

/** Distinctive strings from each weekly report: its title and each substantial line. */
export function fingerprints(notesDir) {
  const prints = [];
  if (!fs.existsSync(notesDir)) return prints;
  for (const name of fs.readdirSync(notesDir)) {
    if (!name.endsWith('.md')) continue;
    const { data, content } = matter(fs.readFileSync(path.join(notesDir, name), 'utf8'));
    if (data.type !== 'weekly') continue;
    prints.push(name.slice(0, -3), data.title);
    for (const line of content.split('\n')) {
      const clean = line.replace(/[^\p{L}\p{N} ]/gu, '').trim();
      if (clean.length >= 24) prints.push(clean.slice(0, 40));
    }
  }
  return prints.filter(Boolean);
}

export function findLeaks(dist, prints) {
  const leaks = [];
  for (const file of files(dist)) {
    if (!/\.(html|xml|json|txt|js|css)$/.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const print of prints) if (text.includes(print)) leaks.push(`${path.relative(dist, file)}: "${print}"`);
  }
  return leaks;
}

export async function protect(dist, notesDir, password) {
  const prints = fingerprints(notesDir);
  const page = path.join(dist, 'weekly', 'index.html');
  const html = fs.readFileSync(page, 'utf8');
  const match = html.match(SECRET);
  if (!match) throw new Error('Could not find the Weekly content to encrypt.');
  if (prints.length && !password) {
    throw new Error('WEEKLY_PASSWORD is not set, so the site was not finished. Weekly stays unpublished.');
  }
  const payload = await encrypt(match[1], password || crypto.randomUUID());
  const script = `<script type="application/json" id="weekly-cipher">${JSON.stringify(payload)}</script>`;
  fs.writeFileSync(page, html.replace(SECRET, () => script));

  const leaks = findLeaks(dist, prints);
  if (leaks.length) {
    fs.rmSync(dist, { recursive: true, force: true });
    throw new Error(`Weekly text leaked, so the build output was deleted:\n  ${leaks.join('\n  ')}`);
  }
  return prints.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  protect(path.resolve('dist'), path.resolve('src/content/notes'), process.env.WEEKLY_PASSWORD)
    .then(() => console.log('Weekly encrypted; leak check passed.'))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
