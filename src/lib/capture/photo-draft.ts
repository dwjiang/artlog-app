import { db } from '../../db/client';
import { settings } from '../../db/schema';
import { eq } from 'drizzle-orm';
import type { PhotoKind } from '../../../shared/collection/album';

export type DraftPhoto = { localId: string; path: string; kind: PhotoKind; capturedAt: number; caption?: string; review?: 'checking' | 'conflict' | 'uncertain'; recognized?: { title: string; artist: string; objectId: import('../../../convex/_generated/dataModel').Id<'objects'>; artworkId: import('../../../convex/_generated/dataModel').Id<'artworks'> } };
function key(owner: string, draftId: string) { return `photoDraft:${owner}:${draftId}`; }
export function readPhotoDraft(owner: string, draftId: string): DraftPhoto[] {
  const value = db.select().from(settings).where(eq(settings.key, key(owner, draftId))).get()?.value;
  if (!value) return [];
  try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((photo): photo is DraftPhoto => typeof photo?.localId === 'string' && typeof photo?.path === 'string' && ['full', 'detail', 'label'].includes(photo?.kind) && Number.isFinite(photo?.capturedAt)) : []; } catch { return []; }
}
export function writePhotoDraft(owner: string, draftId: string, photos: DraftPhoto[]) {
  db.insert(settings).values({ key: key(owner, draftId), value: JSON.stringify(photos) })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(photos) } }).run();
}
export function clearPhotoDraft(owner: string, draftId: string) {
  db.delete(settings).where(eq(settings.key, key(owner, draftId))).run();
}
