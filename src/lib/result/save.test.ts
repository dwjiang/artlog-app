import { db } from '@/db/client';
import { artworkPhotos, artworkEncounters, notes, savedWorks, settings } from '@/db/schema';
import { selectArtworkPhotos, selectArtworkEncounters, editArtworkPhoto } from '@/db/repos/artwork-album';
import { readPhotoDraft, writePhotoDraft, updatePhotoSession, isLabelCapture } from '@/lib/capture/photo-draft';
import { getFunctionName } from 'convex/server';

import { saveErrorMessage, saveResult } from './save';
import { draftFromCandidate } from './snapshot';
import { toResultViewState } from './state';
import { bridge, confidentScan, lilies, missScan, SCAN_ID, softScan } from '@/components/scan/result/__fixtures__/scan';
import { getSavedWork } from '@/db/repos/saved-works';
import { upsertVisit } from '@/db/repos/visits';
import { contributeLabel } from '@/lib/label/contribute';
import { formStateFromFlow } from '@/lib/label/fields';

const mockMutation = jest.fn();
jest.mock('@/lib/label/contribute', () => ({ contributeLabel: jest.fn(), contributionErrorMessage: () => 'Couldn’t save to the shared index right now' }));
const mockVisitByDefault = jest.fn();
const mockVisitForSave = jest.fn();
let mockUuid = 0;

jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
jest.mock('@/lib/convex-client', () => ({
  convex: { mutation: (fn: unknown, args: unknown) => mockMutation(jest.requireActual('convex/server').getFunctionName(fn), args) },
}));
const mockFlush = jest.fn();
jest.mock('@/lib/account/collection-sync', () => ({ flushJournal: () => mockFlush() }));
jest.mock('@/lib/venue/use-venue', () => ({ visitByDefault: (...args: unknown[]) => mockVisitByDefault(...args), visitForSave: (...args: unknown[]) => mockVisitForSave(...args) }));
jest.mock('@/lib/venue/venue-db', () => ({ venueNameById: async (id: string) => id === 'museum-met' ? 'The Met' : undefined }));
jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${++mockUuid}` }));

const capture = {
  localId: '5a1f0c4e-3d2b-4e8a-9f61-0c7d2b9e4a10', owner: 'device:test-installation', capturedAt: 1234,
  photoPath: 'photos/c1.jpg', cropPath: 'crops/c1.jpg',
  venueId: 'museum-met' as never, visitId: null, visitLocalId: 'aea0b816-f46f-5312-a657-f92d1af2cb76',
};
const contribution = { scanId: SCAN_ID, capture: { ...capture, descriptors: new ArrayBuffer(0), keypoints: new ArrayBuffer(0) },
  state: formStateFromFlow({ stage: 'verified', moderation: 'clear', evidence: ['ocr'], warnings: [], updatedAt: 1,
    fields: { title: { value: 'Water Lilies', evidence: 'ocr', locked: false }, artist: { value: 'Claude Monet', evidence: 'ocr', locked: false } } }) };

it('automatically shares a confirmed label after the artwork is saved locally', async () => {
  jest.mocked(contributeLabel).mockImplementation(async () => {
    expect(await getSavedWork(`uuid-${mockUuid}`)).toBeDefined();
    return { contributionId: 'contribution-1' as never, status: 'tentative' };
  });
  const result = await saveResult({ capture, draft: draftFromCandidate(lilies), contribution });
  expect(await result.contribution).toEqual({ result: { contributionId: 'contribution-1', status: 'tentative' } });
  expect(contributeLabel).toHaveBeenCalledWith(contribution);
});

it('preserves the saved artwork when automatic contribution sharing fails', async () => {
  jest.mocked(contributeLabel).mockRejectedValue(new Error('offline'));
  const result = await saveResult({ capture, draft: draftFromCandidate(lilies), contribution });
  expect(await result.contribution).toEqual({ error: 'Couldn’t save to the shared index right now' });
  expect(await getSavedWork(result.localId)).toMatchObject({ title: 'Water Lilies' });
});

it('does not share if saving fails or the capture moves to a different visit context', async () => {
  writePhotoDraft(capture.owner, capture.photoPath, [{ localId: 'review-photo', path: 'photo.jpg', kind: 'full', capturedAt: 1, review: 'conflict' }]);
  await expect(saveResult({ capture, draft: draftFromCandidate(lilies), contribution })).rejects.toThrow('Review your added photos');
  expect(contributeLabel).not.toHaveBeenCalled();
  writePhotoDraft(capture.owner, capture.photoPath, []);
  updatePhotoSession(capture.owner, capture.photoPath, { visit: { kind: 'none' } });
  const result = await saveResult({ capture, draft: draftFromCandidate(lilies), contribution });
  expect(result.contribution).toBeUndefined();
  expect(contributeLabel).not.toHaveBeenCalled();
});

beforeAll(async () => {
  await upsertVisit({ visitedOn: '1970-01-01', timeZone: 'UTC', localId: 'aea0b816-f46f-5312-a657-f92d1af2cb76', venueId: 'museum-met' as never, venueName: 'The Met', startedAt: 1 });
});

/** The visit `visitForSave` starts for a venue-only capture: the controller's row, as the app's would be. */
const STARTED_VISIT = '2b1c7e0a-0d3f-4c6e-9a1b-5d7e8f9a0b1c';

beforeEach(() => {
  for (const table of [artworkPhotos, artworkEncounters, notes, savedWorks, settings]) db.delete(table).run();
  jest.resetAllMocks();
  mockFlush.mockResolvedValue(undefined);
  mockMutation.mockResolvedValue({ collectionId: 'col-1', updatedAt: 20, updatedBy: 'device' });
  mockVisitByDefault.mockReturnValue(true);
  mockVisitForSave.mockImplementation(async (venueId: never, capturedAt: number) => {
    const visit = { localId: STARTED_VISIT, venueId, venueName: 'Legion of Honor', startedAt: capturedAt, visitedOn: '1970-01-01', timeZone: 'UTC' };
    await upsertVisit(visit);
    return visit;
  });
});

it('saves an untouched confident card locally and passes the suggestion to the server', async () => {
  const view = toResultViewState(confidentScan);
  const { localId, synced } = await saveResult({ scanId: SCAN_ID, capture, view, draft: draftFromCandidate(lilies) });
  const row = await getSavedWork(localId);
  expect(row).toMatchObject({
    title: 'Water Lilies', artist: 'Claude Monet', date: '1916', medium: 'Oil on canvas', institution: 'Metropolitan Museum of Art',
    venueId: 'museum-met', venueName: 'The Met', visitLocalId: 'aea0b816-f46f-5312-a657-f92d1af2cb76', gallery: 'Gallery 819',
    objectId: lilies.objectId, artworkId: lilies.artworkId, scanId: SCAN_ID, photoPath: 'photos/c1.jpg', cropPath: 'crops/c1.preview.jpg',
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

it('starts the museum visit for a venue-only capture, dated by the shutter, and confirms the scan into it', async () => {
  const view = toResultViewState(softScan, { chosenObjectId: bridge.objectId });
  const venueOnly = { ...capture, visitLocalId: null, visitId: null };
  const { localId, synced, completion } = await saveResult({ scanId: SCAN_ID, capture: venueOnly, view, draft: draftFromCandidate(bridge) });
  await synced;
  expect(mockVisitByDefault).toHaveBeenCalledWith('museum-met', 1234);
  expect(mockVisitForSave).toHaveBeenCalledWith('museum-met', 1234);
  expect(await getSavedWork(localId)).toMatchObject({ title: 'The Japanese Footbridge', venueId: 'museum-met', venueName: 'Legion of Honor', visitLocalId: STARTED_VISIT, gallery: null });
  expect(selectArtworkPhotos(localId).all()[0].visitLocalId).toBe(STARTED_VISIT);
  expect(completion.visitLabel).toBe('Legion of Honor · 1 Jan 1970');
  expect(mockMutation.mock.calls[0][1]).toMatchObject({ scanId: SCAN_ID, objectId: bridge.objectId, venueId: 'museum-met', visitLocalId: STARTED_VISIT, suggested: null });
});

it('saves a venue-only capture with no visit but its museum after the person ended the visit there today, still confirming the scan', async () => {
  mockVisitByDefault.mockReturnValue(false);
  const venueOnly = { ...capture, visitLocalId: null, visitId: null };
  const { localId, synced, completion, contribution: shared } = await saveResult({ scanId: SCAN_ID, capture: venueOnly, view: toResultViewState(confidentScan), draft: draftFromCandidate(lilies), contribution });
  await synced;
  expect(mockVisitForSave).not.toHaveBeenCalled();
  expect(await getSavedWork(localId)).toMatchObject({ visitLocalId: null, venueId: 'museum-met', venueName: 'The Met' });
  expect(completion.visitLabel).toBe('No visit · Collection only');
  expect(mockMutation).toHaveBeenCalledWith('collections:saveToCollection', expect.objectContaining({ scanId: SCAN_ID, venueId: 'museum-met', visitLocalId: undefined, suggested: { title: 'Water Lilies', artist: 'Claude Monet' } }));
  expect(shared).toBeDefined();
});

it('starts the visit when the draft chooses the museum, even after an ending there today', async () => {
  mockVisitByDefault.mockReturnValue(false);
  const venueOnly = { ...capture, visitLocalId: null, visitId: null };
  updatePhotoSession(venueOnly.owner, venueOnly.photoPath, { visit: { kind: 'venue', venueId: 'museum-met' as never } });
  const { localId, synced } = await saveResult({ scanId: SCAN_ID, capture: venueOnly, view: toResultViewState(confidentScan), draft: draftFromCandidate(lilies) });
  await synced;
  expect(mockVisitForSave).toHaveBeenCalledWith('museum-met', 1234);
  expect(await getSavedWork(localId)).toMatchObject({ visitLocalId: STARTED_VISIT, venueId: 'museum-met' });
  expect(mockMutation).toHaveBeenCalledWith('collections:saveToCollection', expect.objectContaining({ scanId: SCAN_ID, visitLocalId: STARTED_VISIT, suggested: { title: 'Water Lilies', artist: 'Claude Monet' } }));
});

it('does not start a visit when saving fails before the artwork is written', async () => {
  writePhotoDraft(capture.owner, capture.photoPath, [{ localId: 'unconfirmed', path: 'different.jpg', capturedAt: 1235, kind: 'full', review: 'conflict' }]);
  await expect(saveResult({ capture: { ...capture, visitLocalId: null, visitId: null }, view: toResultViewState(confidentScan), draft: draftFromCandidate(lilies) })).rejects.toThrow('Review your added photos before saving.');
  expect(mockVisitForSave).not.toHaveBeenCalled();
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

it('tells the user to pick another visit when the chosen draft visit no longer exists', async () => {
  updatePhotoSession(capture.owner, capture.photoPath, { visit: { kind: 'visit', localId: 'deleted-visit' } });
  const attempt = saveResult({ capture, draft: draftFromCandidate(lilies) });
  await expect(attempt).rejects.toThrow('Choose an available visit before saving.');
  expect(saveErrorMessage(await attempt.catch((cause: unknown) => cause))).toBe('Choose an available visit before saving.');
  expect(saveErrorMessage(new Error('SQLITE_BUSY'))).toBe('Couldn’t save. Try again.');
  expect(mockMutation).not.toHaveBeenCalled();
});

it('saves every new photo to the draft visit, preserving the capture date and earlier encounters', async () => {
  await upsertVisit({ localId: 'eaebe816-f46f-5312-a657-f92d1af2cb76', venueId: 'museum-other' as never, venueName: 'Other museum', visitedOn: '1970-01-02', timeZone: 'UTC' });
  const view = toResultViewState(confidentScan);
  const first = await saveResult({ capture, view, draft: draftFromCandidate(lilies) });
  const nextCapture = { ...capture, localId: 'next-capture', photoPath: 'next.jpg', cropPath: 'next-crop.jpg', capturedAt: 5678 };
  updatePhotoSession(capture.owner, nextCapture.photoPath, { visit: { kind: 'visit', localId: 'eaebe816-f46f-5312-a657-f92d1af2cb76' }, photos: [{ localId: 'detail', path: 'detail.jpg', capturedAt: 5679, kind: 'detail' }] });
  const next = await saveResult({ capture: nextCapture, view, draft: draftFromCandidate(lilies) });
  expect(next.localId).toBe(first.localId);
  expect(selectArtworkPhotos(first.localId).all()).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: capture.photoPath, visitLocalId: capture.visitLocalId, capturedAt: 1234 }),
    expect.objectContaining({ path: 'next.jpg', visitLocalId: 'eaebe816-f46f-5312-a657-f92d1af2cb76', capturedAt: 5678 }),
    expect.objectContaining({ path: 'detail.jpg', visitLocalId: 'eaebe816-f46f-5312-a657-f92d1af2cb76', capturedAt: 5679 }),
  ]));
  expect(next.completion).toMatchObject({ savedId: first.localId, wasExisting: true, photoPaths: ['next.jpg', 'detail.jpg'], visitLabel: 'Other museum · 2 Jan 1970' });
});

it('can explicitly save a scan without its originally selected visit', async () => {
  updatePhotoSession(capture.owner, capture.photoPath, { visit: { kind: 'none' } });
  const result = await saveResult({ scanId: SCAN_ID, capture, view: toResultViewState(confidentScan), draft: draftFromCandidate(lilies) });
  await result.synced;
  expect(mockMutation).toHaveBeenCalledWith('collections:saveToCollection', expect.objectContaining({ scanId: undefined, suggested: null }));
  expect(await getSavedWork(result.localId)).toMatchObject({ visitLocalId: null, venueId: null });
  expect(selectArtworkPhotos(result.localId).all()[0].visitLocalId).toBeNull();
  expect(result.completion.visitLabel).toBe('No visit · Collection only');
});

it('stops confirming a scan when saving a venue-only capture without its venue', async () => {
  const venueOnly = { ...capture, visitLocalId: null, visitId: null };
  updatePhotoSession(venueOnly.owner, venueOnly.photoPath, { visit: { kind: 'none' } });
  const result = await saveResult({ scanId: SCAN_ID, capture: venueOnly, view: toResultViewState(confidentScan), draft: draftFromCandidate(lilies) });
  expect(mockVisitForSave).not.toHaveBeenCalled();
  await result.synced;
  expect(mockMutation).toHaveBeenCalledWith('collections:saveToCollection', expect.objectContaining({ scanId: undefined, venueId: undefined, suggested: null }));
  expect(await getSavedWork(result.localId)).toMatchObject({ visitLocalId: null, venueId: null, venueName: null });
});

it('keeps label-first captures classified as identification material after saving', async () => {
  updatePhotoSession(capture.owner, capture.photoPath, { primaryKind: 'label' });
  const result = await saveResult({ capture, draft: draftFromCandidate() });
  expect(selectArtworkPhotos(result.localId).all()[0].kind).toBe('label');
  expect(isLabelCapture(capture)).toBe(true);
});

it('preserves label classification when a deleted label photo is saved again', async () => {
  updatePhotoSession(capture.owner, capture.photoPath, { primaryKind: 'label' });
  await saveResult({ capture, draft: draftFromCandidate() });
  editArtworkPhoto(capture.localId, { deletedAt: 2000 });
  const restored = await saveResult({ capture, draft: draftFromCandidate() });
  expect(selectArtworkPhotos(restored.localId).all()[0]).toMatchObject({ path: capture.photoPath, kind: 'label' });
});
