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
jest.mock('@/lib/venue/venue-db', () => ({ venueNameById: (id: string) => mockVenueName(id) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${++mockUuid}` }));

const capture = {
  photoPath: 'photos/c1.jpg', cropPath: 'crops/c1.jpg',
  venueId: 'museum-met' as never, visitId: null, visitLocalId: 'visit-local-1',
};

beforeAll(async () => {
  await upsertVisit({ localId: 'visit-local-1', venueId: 'museum-met' as never, venueName: 'The Met', startedAt: 1, remoteVisitId: 'visit-remote-1' as never });
});

beforeEach(() => {
  jest.resetAllMocks();
  mockMutation.mockResolvedValue({ collectionId: 'col-1' });
  mockVenueName.mockResolvedValue('Legion of Honor');
});

it('saves an untouched confident card locally and passes the suggestion to the server', async () => {
  const view = toResultViewState(confidentScan);
  const { localId, synced } = await saveResult({ scanId: SCAN_ID, capture, view, draft: draftFromCandidate(lilies) });
  const row = await getSavedWork(localId);
  expect(row).toMatchObject({
    title: 'Water Lilies', artist: 'Claude Monet', date: '1916', medium: 'Oil on canvas', institution: 'Metropolitan Museum of Art',
    venueId: 'museum-met', venueName: 'The Met', visitLocalId: 'visit-local-1', gallery: 'Gallery 819',
    objectId: lilies.objectId, artworkId: lilies.artworkId, scanId: SCAN_ID, photoPath: 'photos/c1.jpg', cropPath: 'crops/c1.jpg',
  });
  expect(row?.syncedAt).toBeNull();
  await synced;
  expect(getFunctionName).toBeDefined();
  expect(mockMutation).toHaveBeenCalledWith('collections:saveToCollection', {
    localId, scanId: SCAN_ID, objectId: lilies.objectId, artworkId: lilies.artworkId, venueId: 'museum-met', visitId: 'visit-remote-1',
    gallery: 'Gallery 819',
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
  expect(mockMutation.mock.calls[0][1]).toMatchObject({ objectId: bridge.objectId, visitId: undefined, suggested: null });
});

it('saves a typed title on an unidentified card with no object', async () => {
  const draft = { ...draftFromCandidate(undefined), title: 'Untitled pond', artist: '' };
  const { localId, synced } = await saveResult({ scanId: SCAN_ID, capture, view: toResultViewState(missScan), draft });
  await synced;
  expect(await getSavedWork(localId)).toMatchObject({ title: 'Untitled pond', artist: '', objectId: null, artworkId: null });
  expect(mockMutation.mock.calls[0][1]).toMatchObject({ objectId: undefined, artworkId: undefined, suggested: null });
});

it('refuses a blank title before touching the store', async () => {
  await expect(saveResult({ scanId: SCAN_ID, capture, view: toResultViewState(missScan), draft: draftFromCandidate(undefined) }))
    .rejects.toThrow('A title is required to save');
  expect(mockMutation).not.toHaveBeenCalled();
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
