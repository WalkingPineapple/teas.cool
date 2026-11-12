import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const notes = defineCollection({
  // File names are already URL-safe slugs, so keep them exactly.
  loader: glob({
    pattern: '*.md',
    base: './src/content/notes',
    generateId: ({ entry }) => entry.replace(/\.md$/, ''),
  }),
  schema: z.object({
    title: z.string(),
    type: z.enum(['writing', 'reflection', 'story', 'reading', 'travel', 'weekly']),
    date: z.coerce.date(),
    summary: z.string().optional(),
    tags: z.array(z.string()).default([]),
    aliases: z.array(z.string()).default([]),
    source: z.string().optional(),
    author: z.string().optional(),
    rating: z.number().min(0).max(5).optional(),
    place: z.string().optional(),
    // Stories: when it happened, e.g. 2014, "Summer 2019" or "2014-2016". Shown as written; the first year in it sets the order.
    when: z.preprocess(
      (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? undefined : String(v)),
      z.string().optional(),
    ),
  }),
});

export const collections = { notes };
