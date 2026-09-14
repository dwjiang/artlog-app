import type { Note, SavedWork, Visit } from '@/db/schema';
import { buildExport } from './build-export';

const work: SavedWork = {
  localId: 'work-1', title: 'Water Lilies', artist: 'Claude Monet', date: '1916', medium: 'Oil on canvas',
  institution: 'The Met', venueName: 'The Met', venueId: null, gallery: '819', savedAt: 123,
  visitLocalId: 'visit-1', objectId: null, artworkId: null, scanId: null, photoPath: 'photos/full.jpg', photoStorageId: null, cropStorageId: null, cropPath: 'photos/crop.jpg',
  syncedAt: 456, syncedBy: null, revision: 3, deletedAt: null,
};
const visit: Visit = { localId: 'visit-1', venueId: 'museum-1' as Visit['venueId'], venueName: 'The Met', startedAt: 100, endedAt: null, remoteVisitId: null, endSyncedAt: null };
const note: Note = { savedLocalId: 'work-1', text: 'Look at the reflections', updatedAt: 456 };

it('exports a versioned metadata snapshot and joins notes by local work ID', () => {
  const result = buildExport({ works: [work], visits: [visit], notes: [note] });
  expect(result).toEqual({
    version: 1, exportedAt: expect.any(String),
    visits: [{ localId: 'visit-1', venueId: 'museum-1', venueName: 'The Met', startedAt: 100, endedAt: null }],
    works: [{ localId: 'work-1', title: 'Water Lilies', artist: 'Claude Monet', date: '1916', medium: 'Oil on canvas',
      institution: 'The Met', venue: 'The Met', gallery: '819', savedAt: 123, note: note.text, objectId: null, artworkId: null }],
  });
  expect(new Date(result.exportedAt).toISOString()).toBe(result.exportedAt);
});

it('excludes photos, file paths, scan IDs, sync bookkeeping and deleted works', () => {
  const result = buildExport({ works: [work, { ...work, localId: 'deleted', deletedAt: 99 }], visits: [visit], notes: [note] });
  expect(result.works).toHaveLength(1);
  const json = JSON.stringify(result);
  for (const hidden of ['photoPath', 'cropPath', 'photos/', 'scanId', 'syncedAt', 'syncedBy', 'revision', 'remoteVisitId', 'endSyncedAt', 'deleted']) {
    expect(json).not.toContain(hidden);
  }
});

it('handles an empty collection and missing notes', () => {
  expect(buildExport({ works: [], visits: [], notes: [] })).toMatchObject({ version: 1, visits: [], works: [] });
  expect(buildExport({ works: [work], visits: [], notes: [] }).works[0].note).toBeNull();
});
