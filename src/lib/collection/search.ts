import type { SavedWork } from '@/db/schema';

type Searchable = Pick<SavedWork, 'title' | 'artist' | 'institution'>;

/** Case-insensitive substring match on title, artist or institution; a blank query keeps every work. */
export function filterWorks<T extends Searchable>(works: T[], query: string): T[] {
  const term = query.trim().toLowerCase();
  if (!term) return works;
  return works.filter((work) => [work.title, work.artist, work.institution].some((field) => field?.toLowerCase().includes(term)));
}
