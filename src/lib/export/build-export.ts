import type { Note, SavedWork, Visit } from '@/db/schema';

export function buildExport({ works, visits, notes }: { works: SavedWork[]; visits: Visit[]; notes: Note[] }) {
  const notesByWork = new Map(notes.map((note) => [note.savedLocalId, note.text]));
  return {
    version: 1 as const,
    exportedAt: new Date().toISOString(),
    visits: visits.map(({ localId, venueId, venueName, visitedOn, timeZone, reflection, startedAt, endedAt }) => ({ localId, venueId, venueName, visitedOn, timeZone, reflection, startedAt, endedAt })),
    works: works.filter((work) => work.deletedAt === null).map((work) => ({
      localId: work.localId, title: work.title, artist: work.artist, date: work.date, medium: work.medium,
      institution: work.institution, venue: work.venueName, gallery: work.gallery, savedAt: work.savedAt,
      note: notesByWork.get(work.localId) ?? null, objectId: work.objectId, artworkId: work.artworkId,
    })),
  };
}
