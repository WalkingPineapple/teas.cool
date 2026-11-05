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
    type: z.enum(['writing', 'reflection', 'reading', 'travel', 'weekly']),
    date: z.coerce.date(),
    summary: z.string().optional(),
    tags: z.array(z.string()).default([]),
    aliases: z.array(z.string()).default([]),
    source: z.string().optional(),
    author: z.string().optional(),
    rating: z.number().min(0).max(5).optional(),
    place: z.string().optional(),
  }),
});

export const collections = { notes };
