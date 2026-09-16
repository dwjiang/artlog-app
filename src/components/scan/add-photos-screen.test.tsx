import { fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { AddPhotosScreen } from './add-photos-screen';
import { CaptureContextScreen } from './capture-context-screen';
import { db } from '@/db/client';
import { artworkEncounters, artworkPhotos, notes, pendingScans, savedWorks, settings, visits } from '@/db/schema';
import { insertSavedWork, getSavedWork } from '@/db/repos/saved-works';
import { getPendingScan, enqueuePendingScan } from '@/db/repos/pending-scans';
import { upsertVisit } from '@/db/repos/visits';
import { selectArtworkPhotos } from '@/db/repos/artwork-album';
import { readPhotoSession, updatePhotoSession } from '@/lib/capture/photo-draft';
import { captureVisitKey } from '@/lib/capture/visit-context';
import { getSetting } from '@/db/repos/settings';
import { draftFromCandidate } from '@/lib/result/snapshot';

const owner = 'device:test-installation';
let mockParams: { draftId: string; title?: string; savedId?: string; visitId?: string };
const mockPush = jest.fn(), mockBack = jest.fn(), mockNavigate = jest.fn(), mockDismissAll = jest.fn(), mockDismissTo = jest.fn();
jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (callback: () => void) => jest.requireActual('react').useEffect(callback, [callback]),
  useRouter: () => ({ navigate: mockNavigate, dismissAll: mockDismissAll, dismissTo: mockDismissTo }),
  router: { push: (...args: unknown[]) => mockPush(...args), back: () => mockBack() }, Stack: { Screen: () => null },
}));
jest.mock('expo-router/react-navigation', () => ({ useIsFocused: () => true }));
jest.mock('react-native-vision-camera', () => ({ Camera: () => null, usePhotoOutput: () => ({}) }));
jest.mock('./camera-permission', () => ({ CameraPermission: () => null }));
jest.mock('../collection/native-segmented-picker', () => ({ NativeSegmentedPicker: () => null }));
jest.mock('../collection/gallery-button', () => ({ GalleryButton: ({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}><Text>{label}</Text></Pressable>;
} }));
jest.mock('@/lib/capture/check-album-photo', () => ({ checkAlbumPhoto: jest.fn() }));
jest.mock('@/lib/account/photo-transfer', () => ({ removePhotoFile: jest.fn() }));
jest.mock('@/lib/files/photos', () => ({ captureFileUri: (path: string) => `file:///${path}` }));
jest.mock('@/lib/account/collection-sync', () => ({ flushJournal: async () => {} }));
jest.mock('@/lib/venue/venue-db', () => ({ venueNameById: async () => undefined }));
jest.mock('@/lib/convex-client', () => ({ convex: { mutation: async () => ({ collectionId: 'remote', updatedAt: 1, updatedBy: 'device' }) } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'saved-new' }));

beforeEach(async () => {
  jest.clearAllMocks();
  for (const table of [artworkPhotos, artworkEncounters, notes, savedWorks, pendingScans, visits, settings]) db.delete(table).run();
  AppState.currentState = 'active';
  mockParams = { draftId: 'saved-artwork', savedId: 'artwork', title: 'Water Lilies', visitId: 'aea0b816-f46f-5312-a657-f92d1af2cb76' };
  await upsertVisit({ localId: 'aea0b816-f46f-5312-a657-f92d1af2cb76', venueId: 'museum-met' as never, venueName: 'The Met', visitedOn: '2026-09-01', timeZone: 'UTC' });
  await upsertVisit({ localId: 'eaebe816-f46f-5312-a657-f92d1af2cb76', venueId: 'museum-other' as never, venueName: 'Other museum', visitedOn: '2026-09-02', timeZone: 'UTC' });
  await insertSavedWork({ localId: 'artwork', title: 'Water Lilies', artist: 'Claude Monet', savedAt: 1, photoPath: 'original.jpg', visitLocalId: 'aea0b816-f46f-5312-a657-f92d1af2cb76', venueId: 'museum-met' as never });
  updatePhotoSession(owner, mockParams.draftId, { photos: [{ localId: 'detail', path: 'detail.jpg', kind: 'detail', capturedAt: 2 }] });
});

it('retains an edited visit after leaving the session and saves only new photos to it', async () => {
  const capture = await render(<AddPhotosScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: 'The Met · 1 Sep 2026 · Change' }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/capture-context', params: { draftId: 'saved-artwork' } });
  await capture.unmount();
  const context = await render(<CaptureContextScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Other museum · 2 Sep 2026' }));
  expect(readPhotoSession(owner, 'saved-artwork').visitLocalId).toBe('eaebe816-f46f-5312-a657-f92d1af2cb76');
  await context.unmount();
  await render(<AddPhotosScreen />);
  expect(await screen.findByRole('button', { name: 'Other museum · 2 Sep 2026 · Change' })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Save 1 photo' }));
  expect(await screen.findByText('1 artwork · 1 new photo')).toBeOnTheScreen();
  expect(screen.getByText('Other museum · 2 Sep 2026')).toBeOnTheScreen();
  expect(screen.getAllByLabelText('Saved photo preview')).toHaveLength(1);
  expect(selectArtworkPhotos('artwork').all()).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: 'original.jpg', visitLocalId: 'aea0b816-f46f-5312-a657-f92d1af2cb76' }),
    expect.objectContaining({ path: 'detail.jpg', visitLocalId: 'eaebe816-f46f-5312-a657-f92d1af2cb76' }),
  ]));
  await fireEvent.press(screen.getByRole('button', { name: 'View artwork' }));
  expect(mockDismissTo).toHaveBeenCalledWith({ pathname: '/(tabs)/(collection)/[savedId]', params: { savedId: 'artwork' } });
});

it('saves an unsaved artwork and every added photo directly from the session', async () => {
  await enqueuePendingScan({ localId: 'capture', photoPath: 'capture.jpg', cropPath: 'crop.jpg', capturedAt: 1, status: 'queued', modelVersion: 'm', attemptModelVersion: 'm', vector: [], descriptors: new ArrayBuffer(0), keypoints: new ArrayBuffer(0), createdAt: 1 });
  const capture = (await getPendingScan('capture'))!;
  mockParams = { draftId: capture.photoPath, title: 'My edited title' };
  updatePhotoSession(owner, capture.photoPath, { visitLocalId: 'eaebe816-f46f-5312-a657-f92d1af2cb76', saveInput: { capture, draft: { ...draftFromCandidate(), title: 'My edited title' } }, photos: [{ localId: 'extra', path: 'extra.jpg', kind: 'detail', capturedAt: 2 }] });
  await render(<AddPhotosScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Save 2 photos' }));
  expect(await screen.findByText('Saved as My edited title.')).toBeOnTheScreen();
  expect(screen.getByText('1 artwork · 2 new photos')).toBeOnTheScreen();
  expect((await getSavedWork('saved-new'))?.title).toBe('My edited title');
  expect(selectArtworkPhotos('saved-new').all().map((photo) => photo.visitLocalId)).toEqual(['eaebe816-f46f-5312-a657-f92d1af2cb76', 'eaebe816-f46f-5312-a657-f92d1af2cb76']);
  expect(readPhotoSession(owner, capture.photoPath).photos).toEqual([]);
  expect(mockBack).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Scan next artwork' }));
  expect(mockDismissAll).toHaveBeenCalledTimes(1);
  expect(mockNavigate).toHaveBeenCalledWith('/(tabs)/(scan)/scan');
  // The draft's visit choice stays with the draft; the next scan keeps resolving its own visit.
  expect(await getSetting(captureVisitKey(owner))).toBeUndefined();
});

it('names a chosen visit that has since been deleted instead of calling it the current visit', async () => {
  updatePhotoSession(owner, mockParams.draftId, { visitLocalId: 'deleted-visit', photos: [{ localId: 'detail', path: 'detail.jpg', kind: 'detail', capturedAt: 2 }] });
  await render(<AddPhotosScreen />);
  expect(await screen.findByRole('button', { name: 'Visit unavailable · Change' })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Save 1 photo' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the photos. Your draft is still here.');
  expect(selectArtworkPhotos('artwork').all().map((photo) => photo.path)).toEqual(['original.jpg']);
});

it('keeps unresolved photos in the draft until the owner explicitly confirms them', async () => {
  updatePhotoSession(owner, mockParams.draftId, { photos: [{ localId: 'detail', path: 'detail.jpg', kind: 'full', capturedAt: 2, review: 'uncertain' }] });
  await render(<AddPhotosScreen />);
  expect(screen.getByRole('button', { name: 'Save 1 photo' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Keep with this artwork' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save 1 photo' }));
  expect(await screen.findByText('Keep this moment.')).toBeOnTheScreen();
  expect(selectArtworkPhotos('artwork').all()).toHaveLength(2);
});
