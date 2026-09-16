import { db } from '@/db/client';
import { artworkPhotos, artworkEncounters, notes, savedWorks, settings } from '@/db/schema';
import { selectArtworkPhotos, selectArtworkEncounters } from '@/db/repos/artwork-album';
import { readPhotoDraft, writePhotoDraft } from '@/lib/capture/photo-draft';
import { getFunctionName } from 'convex/server';

import { saveResult } from './save';
import { draftFromCandidate } from './snapshot';
import { toResultViewState } from './state';
import { bridge, confidentScan, lilies, missScan, SCAN_ID, softScan } from '@/components/scan/result/__fixtures__/scan';
import { getSavedWork } from '@/db/repos/saved-works';
import { upsertVisit } from '@/db/repos/visits';

const mockMutation = jest.fn();
const mockVenueName = jest.fn();
let mockUuid = 0;

jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
jest.mock('@/lib/convex-client', () => ({
  convex: { mutation: (fn: unknown, args: unknown) => mockMutation(jest.requireActual('convex/server').getFunctionName(fn), args) },
}));
const mockFlush = jest.fn();
jest.mock('@/lib/account/collection-sync', () => ({ flushJournal: () => mockFlush() }));
jest.mock('@/lib/venue/venue-db', () => ({ venueNameById: (id: string) => mockVenueName(id) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${++mockUuid}` }));

const capture = {
  localId: '5a1f0c4e-3d2b-4e8a-9f61-0c7d2b9e4a10', owner: 'device:test-installation', capturedAt: 1234,
  photoPath: 'photos/c1.jpg', cropPath: 'crops/c1.jpg',
  venueId: 'museum-met' as never, visitId: null, visitLocalId: 'aea0b816-f46f-5312-a657-f92d1af2cb76',
};

beforeAll(async () => {
  await upsertVisit({ visitedOn: '1970-01-01', timeZone: 'UTC', localId: 'aea0b816-f46f-5312-a657-f92d1af2cb76', venueId: 'museum-met' as never, venueName: 'The Met', startedAt: 1 });
});

beforeEach(() => {
  for (const table of [artworkPhotos, artworkEncounters, notes, savedWorks, settings]) db.delete(table).run();
  jest.resetAllMocks();
  mockFlush.mockResolvedValue(undefined);
  mockMutation.mockResolvedValue({ collectionId: 'col-1', updatedAt: 20, updatedBy: 'device' });
  mockVenueName.mockResolvedValue('Legion of Honor');
});

it('saves an untouched confident card locally and passes the suggestion to the server', async () => {
  const view = toResultViewState(confidentScan);
  const { localId, synced } = await saveResult({ scanId: SCAN_ID, capture, view, draft: draftFromCandidate(lilies) });
  const row = await getSavedWork(localId);
  expect(row).toMatchObject({
    title: 'Water Lilies', artist: 'Claude Monet', date: '1916', medium: 'Oil on canvas', institution: 'Metropolitan Museum of Art',
    venueId: 'museum-met', venueName: 'The Met', visitLocalId: 'aea0b816-f46f-5312-a657-f92d1af2cb76', gallery: 'Gallery 819',
    objectId: lilies.objectId, artworkId: lilies.artworkId, scanId: SCAN_ID, photoPath: 'photos/c1.jpg', cropPath: 'crops/c1.jpg',
  });
  await synced;
  expect(getFunctionName).toBeDefined();
  expect(mockMutation).toHaveBeenCalledWith('collections:saveToCollection', {
    localId, scanId: SCAN_ID, objectId: lilies.objectId, artworkId: lilies.artworkId, venueId: 'museum-met', visitLocalId: 'aea0b816-f46f-5312-a657-f92d1af2cb76', scope: 'test-scope',
    gallery: 'Gallery 819', savedAt: expect.any(Number), venueName: 'The Met',
    snapshot: { title: 'Water Lilies', artist: 'Claude Monet', date: '1916', medium: 'Oil on canvas', institution: 'Metropolitan Museum of Art' },
    suggested: { title: 'Water Lilies', artist: 'Claude Monet' },
  });
  expect((await getSavedWork(localId))?.syncedAt).toEqual(expect.any(Number));
});

it('keeps the suggestion when the title was edited so the server decides the confirm', async () => {
  const { synced } = await saveResult({
    scanId: SCAN_ID, capture, view: toResultViewState(confidentScan), draft: { ...draftFromCandidate(lilies), title: 'Nymphéas' },
  });
  await synced;
  expect(mockMutation.mock.calls[0][1]).toMatchObject({ snapshot: { title: 'Nymphéas' }, suggested: { title: 'Water Lilies', artist: 'Claude Monet' } });
});

it('saves a chosen runner-up on a soft card without a suggestion and names the venue from the local table', async () => {
  const view = toResultViewState(softScan, { chosenObjectId: bridge.objectId });
  const { localId, synced } = await saveResult({
    scanId: SCAN_ID, capture: { ...capture, visitLocalId: null, visitId: null }, view, draft: draftFromCandidate(bridge),
  });
  await synced;
  expect(await getSavedWork(localId)).toMatchObject({ title: 'The Japanese Footbridge', venueName: 'Legion of Honor', visitLocalId: null, gallery: null });
  expect(mockVenueName).toHaveBeenCalledWith('museum-met');
  expect(mockMutation.mock.calls[0][1]).toMatchObject({ objectId: bridge.objectId, visitLocalId: undefined, suggested: null });
});

it('saves a typed title on an unidentified card with no object', async () => {
  const draft = { ...draftFromCandidate(undefined), title: 'Untitled pond', artist: '' };
  const { localId, synced } = await saveResult({ scanId: SCAN_ID, capture, view: toResultViewState(missScan), draft });
  await synced;
  expect(await getSavedWork(localId)).toMatchObject({ title: 'Untitled pond', artist: '', objectId: null, artworkId: null });
  expect(mockMutation.mock.calls[0][1]).toMatchObject({ objectId: undefined, artworkId: undefined, suggested: null });
});

it('saves an unknown artwork without forcing a title', async () => {
  const { localId, synced } = await saveResult({ scanId: SCAN_ID, capture, view: toResultViewState(missScan), draft: draftFromCandidate(undefined) });
  await synced;
  expect(await getSavedWork(localId)).toMatchObject({ title: 'Unidentified artwork', objectId: null });
});

it('commits a three-photo draft to one artwork and clears the draft', async () => {
  writePhotoDraft(capture.owner, capture.photoPath, [
    { localId: 'detail', path: 'detail.jpg', capturedAt: 1235, kind: 'detail' },
    { localId: 'label', path: 'label.jpg', capturedAt: 1236, kind: 'label', caption: 'Wall label' },
  ]);
  const saved = await saveResult({ capture, view: toResultViewState(confidentScan), draft: draftFromCandidate(lilies) });
  await saved.synced;
  expect(selectArtworkPhotos(saved.localId).all().map((photo) => photo.kind)).toEqual(['full', 'detail', 'label']);
  expect(readPhotoDraft(capture.owner, capture.photoPath)).toEqual([]);
  expect(db.select().from(savedWorks).all()).toHaveLength(1);
});

it('preserves an unreviewed photo draft without saving any artwork', async () => {
  writePhotoDraft(capture.owner, capture.photoPath, [
    { localId: 'unconfirmed', path: 'different.jpg', capturedAt: 1235, kind: 'full', review: 'conflict' },
  ]);
  await expect(saveResult({ capture, view: toResultViewState(confidentScan), draft: draftFromCandidate(lilies) })).rejects.toThrow('Review your added photos before saving.');
  expect(db.select().from(savedWorks).all()).toHaveLength(0);
  expect(readPhotoDraft(capture.owner, capture.photoPath)).toHaveLength(1);
  expect(mockMutation).not.toHaveBeenCalled();
});

it('keeps the capture under the scan id so a second save of the same scan reuses the artwork', async () => {
  const first = await saveResult({ scanId: SCAN_ID, capture, view: toResultViewState(confidentScan), draft: draftFromCandidate(lilies) });
  await first.synced;
  expect(selectArtworkPhotos(first.localId).all().map((photo) => photo.localId)).toEqual([capture.localId]);
  const again = await saveResult({ scanId: SCAN_ID, capture, view: toResultViewState(confidentScan), draft: { ...draftFromCandidate(lilies), title: 'Edited later' } });
  await again.synced;
  expect(again.localId).toBe(first.localId);
  expect(db.select().from(savedWorks).all()).toHaveLength(1);
  expect(selectArtworkPhotos(first.localId).all()).toHaveLength(1);
  expect(mockMutation).toHaveBeenCalledTimes(1);
});

it('adds a repeat capture and visit to the same confidently identified object', async () => {
  const first = await saveResult({ capture, view: toResultViewState(confidentScan), draft: draftFromCandidate(lilies) });
  await first.synced;
  const visitLocalId = '18e973df-445f-4d82-9864-40d795a04752';
  await upsertVisit({ localId: visitLocalId, visitedOn: '1970-01-02', timeZone: 'UTC', venueId: capture.venueId, venueName: 'The Met' });
  const next = await saveResult({ capture: { ...capture, localId: '7c9e2b1a-5f3d-4a6b-8e21-3b4c5d6e7f80', visitLocalId, photoPath: 'second.jpg', capturedAt: 86400000 }, view: toResultViewState(confidentScan), draft: draftFromCandidate(lilies) });
  await next.synced;
  expect(next.localId).toBe(first.localId);
  expect(db.select().from(savedWorks).all()).toHaveLength(1);
  expect(selectArtworkPhotos(first.localId).all()).toHaveLength(2);
  expect(selectArtworkEncounters().all()).toHaveLength(2);
});

it('keeps the local row when the server call fails', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockMutation.mockRejectedValue(new Error('Network request failed'));
  const { localId, synced } = await saveResult({ scanId: SCAN_ID, capture, view: toResultViewState(confidentScan), draft: draftFromCandidate(lilies) });
  await expect(synced).resolves.toBeUndefined();
  expect((await getSavedWork(localId))?.syncedAt).toBeNull();
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

it('still records the confirmation when the journal flush fails and the visit is already on the server', async () => {
  mockFlush.mockRejectedValue(new Error('Network request failed'));
  const { localId, synced } = await saveResult({ scanId: SCAN_ID, capture, view: toResultViewState(confidentScan), draft: draftFromCandidate(lilies) });
  await synced;
  expect(mockMutation).toHaveBeenCalledWith('collections:saveToCollection', expect.objectContaining({ localId }));
  expect((await getSavedWork(localId))?.syncedAt).toEqual(expect.any(Number));
});

it.each([{ visitLocalId: 'missing' }, { visitLocalId: '' }, { venueId: 'wrong-museum' as never }])('rejects an invalid requested visit without silently dropping its link: %j', async (fields) => {
  await expect(saveResult({ capture: { ...capture, ...fields }, draft: draftFromCandidate(lilies) })).rejects.toThrow('invalid visit');
  expect(mockMutation).not.toHaveBeenCalled();
});
