import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { insertSavedWork } from '@/db/repos/saved-works';
import { WallDisplayScreen } from './wall-display-screen';

let mockWall: Partial<ReturnType<typeof import('@/lib/wall/use-collection-wall').useCollectionWall>> = { pieces: [], signedIn: true };
jest.mock('@/lib/wall/use-collection-wall', () => ({ useCollectionWall: () => mockWall }));
jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
jest.mock('@/lib/files/photos', () => ({ captureFileUri: (path: string) => `file:///documents/${path}` }));
jest.mock('./photo-visibility', () => ({ PhotoVisibility: () => null }));

const layout = { x: 0.05, y: 0.06, width: 0.52, layer: 0, frame: 'black' as const };
beforeAll(async () => {
  await insertSavedWork({ localId: 'lilies', savedAt: 1, title: 'Water Lilies', artist: 'Claude Monet', cropPath: 'crops/lilies.jpg', syncedAt: 1 });
  await insertSavedWork({ localId: 'unsynced', savedAt: 2, title: 'Haystacks', artist: 'Claude Monet', cropPath: 'crops/haystacks.jpg' });
});
beforeEach(() => { jest.clearAllMocks(); });

it('explains why a hung work cannot share its note until the note has synced', async () => {
  mockWall = { signedIn: true, pieces: [], draft: { color: '#FCFCF9', items: [{ placementId: 'p', saveLocalId: 'lilies', layout }] }, setError: jest.fn() };
  await render(<WallDisplayScreen savedId="lilies" />);
  expect(await screen.findByRole('switch', { name: 'Show note on public wall' })).toBeDisabled();
  expect(screen.getByText('Add a note and let it sync before sharing it.')).toBeOnTheScreen();
});

it('saves a frame change for the hung placement', async () => {
  const setLayoutDraft = jest.fn(), publishLayout = jest.fn().mockResolvedValue(undefined);
  mockWall = { signedIn: true, pieces: [], draft: { color: '#FCFCF9', items: [{ placementId: 'p', saveLocalId: 'lilies', layout }] },
    repository: { setLayoutDraft, publishLayout } as never, setError: jest.fn() };
  await render(<WallDisplayScreen savedId="lilies" />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Baroque' }));
  expect(setLayoutDraft).toHaveBeenCalledWith(expect.objectContaining({ items: [expect.objectContaining({ placementId: 'p', layout: expect.objectContaining({ frame: 'baroque' }) })] }));
  expect(publishLayout).toHaveBeenCalledTimes(1);
});

it('previews the selected artwork and offers all eight frames without preset sizes', async () => {
  mockWall = { signedIn: true, pieces: [{ localId: 'p', layout, cropPath: 'crops/lilies.jpg', artwork: {
    title: 'Water Lilies', artist: 'Claude Monet', media: { kind: 'placeholder', width: 1, height: 1 },
  } }], draft: { color: '#FCFCF9', items: [{ placementId: 'p', saveLocalId: 'lilies', layout }] }, setError: jest.fn() };
  await render(<WallDisplayScreen savedId="lilies" />);
  expect(await screen.findByRole('image', { name: 'Water Lilies, Black frame preview' })).toBeOnTheScreen();
  for (const name of ['Gilt', 'Baroque', 'Walnut', 'Oak', 'Black', 'White float', 'Mat', 'No frame']) {
    expect(screen.getByRole('button', { name })).toBeOnTheScreen();
  }
  for (const name of ['S', 'M', 'L']) expect(screen.queryByRole('button', { name })).toBeNull();
  expect(screen.getByText(/Drag its corner to resize/)).toBeOnTheScreen();
});

it('tells the owner when the artwork is not on the wall', async () => {
  mockWall = { signedIn: true, pieces: [], draft: { color: '#FCFCF9', items: [] }, setError: jest.fn() };
  await render(<WallDisplayScreen savedId="lilies" />);
  expect(await screen.findByText('This artwork is not on your wall.')).toBeOnTheScreen();
});

it('re-reads the wall for a synced work so note eligibility reflects the latest sync', async () => {
  const refresh = jest.fn().mockResolvedValue(undefined);
  const acknowledged = { color: '#FCFCF9', items: [{ placementId: 'p', saveLocalId: 'lilies', layout, itemId: 'i', noteVisible: false, noteEligible: false }] };
  mockWall = { signedIn: true, pieces: [], draft: { color: '#FCFCF9', items: acknowledged.items }, acknowledged: acknowledged as never, refresh, setError: jest.fn() };
  const view = await render(<WallDisplayScreen savedId="lilies" />);
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  await view.rerender(<WallDisplayScreen savedId="unsynced" />);
  expect(await screen.findByRole('header', { name: 'Haystacks' })).toBeOnTheScreen();
  expect(refresh).toHaveBeenCalledTimes(1);
});
