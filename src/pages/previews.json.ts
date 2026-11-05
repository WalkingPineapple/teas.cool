import { publicNotes } from '../lib/content';

export async function GET() {
  const notes = await publicNotes();
  const entries = notes.map((n) => [
    n.id,
    { title: n.data.title, type: n.data.type, summary: n.data.summary ?? (n.body ?? '').replace(/[#>*_`\[\]]/g, '').trim().slice(0, 160) },
  ]);
  return new Response(JSON.stringify(Object.fromEntries(entries)), { headers: { 'Content-Type': 'application/json' } });
}
