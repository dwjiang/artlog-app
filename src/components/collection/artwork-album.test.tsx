import { fireEvent, render, screen } from '@testing-library/react-native';
import type { SavedWork } from '@/db/schema';
import { router } from 'expo-router';
import { ArtworkAlbum } from './artwork-album';

const initialPhotos = Array.from({ length: 4 }, (_, index) => ({ localId: `photo-${index}`, owner: 'device:guest', savedLocalId: 'work', kind: 'full', path: `photo-${index}.jpg`, caption: `Museum view ${index + 1}` }));
let mockPhotos = initialPhotos;
let mockPhotosUpdatedAt: Date | undefined;
let mockPhotosError: Error | undefined;
jest.mock('@expo/ui');
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/files/photos', () => ({ captureFileUri: (path: string) => `file:///${path}` }));
jest.mock('@/db/repos/artwork-album', () => ({ selectArtworkPhotos: () => 'photos', selectArtworkEncounters: () => 'encounters', editEncounter: jest.fn() }));
jest.mock('@/db/repos/visits', () => ({ listVisits: () => 'visits' }));
jest.mock('drizzle-orm/expo-sqlite', () => ({ useLiveQuery: (query: string) => ({ data: query === 'photos' ? mockPhotos : [], updatedAt: mockPhotosUpdatedAt, error: mockPhotosError }) }));
const work = { localId: 'work', owner: 'device:guest', title: 'Water Lilies', artist: 'Claude Monet' } as SavedWork;
beforeEach(() => { jest.clearAllMocks(); mockPhotos = initialPhotos; mockPhotosUpdatedAt = undefined; mockPhotosError = undefined; });

it('selects a thumbnail and edits that photo', async () => {
  await render(<ArtworkAlbum work={work} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Show full photo 3' }));
  expect(screen.getByRole('button', { name: 'Show full photo 3', selected: true })).toBeOnTheScreen();
  expect(screen.getByText('Museum view 3')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Edit full photo 3' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/photo-details', params: { savedId: 'work', photoId: 'photo-2' } });
});

it('keeps the selected photo caption and editing action together while browsing', async () => {
  await render(<ArtworkAlbum work={work} />);
  expect(screen.getByRole('header', { name: 'Claude Monet' })).toBeOnTheScreen();
  expect(screen.getByText('Museum view 1')).toBeOnTheScreen();
  expect(screen.queryByText('Museum view 2')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Next photo' }));
  expect(screen.queryByText('Museum view 1')).toBeNull();
  expect(screen.getByText('Museum view 2')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Edit full photo 2' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/photo-details', params: { savedId: 'work', photoId: 'photo-1' } });
});

it('waits for the photo read before showing an empty album and distinguishes a read failure', async () => {
  mockPhotos = [];
  const view = await render(<ArtworkAlbum work={work} />);
  expect(screen.getByLabelText('Loading photos…')).toBeOnTheScreen();
  expect(screen.queryByText('Keep your point of view.')).toBeNull();
  mockPhotosUpdatedAt = new Date();
  await view.rerender(<ArtworkAlbum work={work} />);
  expect(screen.getByText('Keep your point of view.')).toBeOnTheScreen();
  mockPhotosError = new Error('Read failed');
  await view.rerender(<ArtworkAlbum work={work} />);
  expect(screen.getByRole('alert')).toHaveTextContent(/Photos couldn’t load\./);
  expect(screen.queryByText('Keep your point of view.')).toBeNull();
});

it('moves to the last remaining photo after photos are deleted, so Previous works on its first tap', async () => {
  const view = await render(<ArtworkAlbum work={work} />);
  for (let index = 0; index < 3; index++) await fireEvent.press(screen.getByRole('button', { name: 'Next photo' }));
  expect(screen.getByText('4 / 4')).toBeOnTheScreen();
  mockPhotos = initialPhotos.slice(0, 2);
  await view.rerender(<ArtworkAlbum work={work} />);
  expect(screen.getByText('2 / 2')).toBeOnTheScreen();
  expect(screen.getByText('Museum view 2')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Previous photo' }));
  expect(screen.getByText('1 / 2')).toBeOnTheScreen();
  expect(screen.getByText('Museum view 1')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Previous photo' })).toBeDisabled();
});

it('resets the photo position when an emptied album receives a new photo', async () => {
  const view = await render(<ArtworkAlbum work={work} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Next photo' }));
  mockPhotos = [];
  await view.rerender(<ArtworkAlbum work={work} />);
  expect(screen.queryByRole('button', { name: 'Previous photo' })).toBeNull();
  mockPhotos = initialPhotos.slice(0, 1);
  await view.rerender(<ArtworkAlbum work={work} />);
  expect(screen.getByText('Museum view 1')).toBeOnTheScreen();
  expect(screen.queryByText('1 / 1')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Next photo' })).toBeNull();
});

it('opens the wall photo that was tapped after the album loads', async () => {
  mockPhotos = [];
  const view = await render(<ArtworkAlbum work={work} photoId="photo-2" />);
  mockPhotos = initialPhotos;
  await view.rerender(<ArtworkAlbum work={work} photoId="photo-2" />);
  expect(screen.getByText('3 / 4')).toBeOnTheScreen();
  expect(screen.getByText('Museum view 3')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Previous photo' }));
  expect(screen.getByText('2 / 4')).toBeOnTheScreen();
});

it('falls back to the first available photo if the requested photo was removed', async () => {
  await render(<ArtworkAlbum work={work} photoId="removed" />);
  expect(screen.getByText('1 / 4')).toBeOnTheScreen();
});


it('adds photos to the displayed artwork from an empty album', async () => {
  mockPhotos = []; mockPhotosUpdatedAt = new Date();
  await render(<ArtworkAlbum work={work} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Add photos' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/add-photos', params: { draftId: 'saved:work', savedId: 'work', title: 'Water Lilies', visitId: undefined } });
});

it('keeps the selected visit for new photos and offers the complete album', async () => {
  mockPhotosUpdatedAt = new Date();
  await render(<ArtworkAlbum work={work} visitId="visit-a" />);
  await fireEvent.press(screen.getByRole('button', { name: 'Add photos' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/add-photos', params: { draftId: 'saved:work', savedId: 'work', title: 'Water Lilies', visitId: 'visit-a' } });
  await fireEvent.press(screen.getByRole('button', { name: 'View all photos' }));
  expect(screen.getByText('Museum view 1')).toBeOnTheScreen();
  expect(screen.queryByText('No photos from this visit yet.')).toBeNull();
});
