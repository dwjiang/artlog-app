import { fireEvent, render, screen } from '@testing-library/react-native';
import type { SavedWork } from '@/db/schema';
import { ArtworkAlbum } from './artwork-album';

const initialPhotos = Array.from({ length: 4 }, (_, index) => ({ localId: `photo-${index}`, owner: 'device:guest', savedLocalId: 'work', kind: 'full', path: `photo-${index}.jpg` }));
let mockPhotos = initialPhotos;
jest.mock('@expo/ui');
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/files/photos', () => ({ captureFileUri: (path: string) => `file:///${path}` }));
jest.mock('@/db/repos/artwork-album', () => ({ selectArtworkPhotos: () => 'photos', selectArtworkEncounters: () => 'encounters', editEncounter: jest.fn() }));
jest.mock('@/db/repos/visits', () => ({ listVisits: () => 'visits' }));
jest.mock('drizzle-orm/expo-sqlite', () => ({ useLiveQuery: (query: string) => ({ data: query === 'photos' ? mockPhotos : [] }) }));
jest.mock('./photo-visibility', () => ({ PhotoVisibility: ({ photoId }: { photoId: string }) => {
  const { Text } = jest.requireActual('react-native');
  return <Text>{`Visibility of ${photoId}`}</Text>;
} }));
const work = { localId: 'work', owner: 'device:guest', title: 'Water Lilies', artist: 'Claude Monet' } as SavedWork;
beforeEach(() => { mockPhotos = initialPhotos; });

it('moves to the last remaining photo after photos are deleted, so Previous works on its first tap', async () => {
  const view = await render(<ArtworkAlbum work={work} />);
  for (let index = 0; index < 3; index++) await fireEvent.press(screen.getByRole('button', { name: 'Next photo' }));
  expect(screen.getByText('4 / 4')).toBeOnTheScreen();
  mockPhotos = initialPhotos.slice(0, 2);
  await view.rerender(<ArtworkAlbum work={work} />);
  expect(screen.getByText('2 / 2')).toBeOnTheScreen();
  expect(screen.getByText('Visibility of photo-1')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Previous photo' }));
  expect(screen.getByText('1 / 2')).toBeOnTheScreen();
  expect(screen.getByText('Visibility of photo-0')).toBeOnTheScreen();
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
  expect(screen.getByText('1 / 1')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Previous photo' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next photo' })).toBeDisabled();
});

it('opens the wall photo that was tapped after the album loads', async () => {
  mockPhotos = [];
  const view = await render(<ArtworkAlbum work={work} photoId="photo-2" />);
  mockPhotos = initialPhotos;
  await view.rerender(<ArtworkAlbum work={work} photoId="photo-2" />);
  expect(screen.getByText('3 / 4')).toBeOnTheScreen();
  expect(screen.getByText('Visibility of photo-2')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Previous photo' }));
  expect(screen.getByText('2 / 4')).toBeOnTheScreen();
});

it('falls back to the first available photo if the requested photo was removed', async () => {
  await render(<ArtworkAlbum work={work} photoId="removed" />);
  expect(screen.getByText('1 / 4')).toBeOnTheScreen();
});
