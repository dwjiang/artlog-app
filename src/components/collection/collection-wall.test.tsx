import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { ConvexError } from 'convex/values';
import type { ReactNode } from 'react';
import { Image } from 'react-native';
import type { SavedWork } from '@/db/schema';
import { useCollectionWall } from '@/lib/wall/use-collection-wall';
import { wallAspect } from '@/lib/wall/wall-layout';
import type { OwnerWall, WallTransport } from '@/lib/wall/wall-transport';
import { switchOwner } from '@/lib/account/owner-store';
import { CollectionWall } from './collection-wall';

const mockPush = jest.fn();
let mockToken: string | null = 'token';
const mockTransport = {
  getMine: jest.fn(), setLayout: jest.fn(), listMine: jest.fn(), setNoteVisibility: jest.fn(),
} satisfies WallTransport;
jest.mock('@convex-dev/auth/react', () => ({ useAuthToken: () => mockToken }));
jest.mock('expo-network', () => ({ getNetworkStateAsync: async () => ({ isConnected: true, isInternetReachable: true }) }));
jest.mock('@/lib/wall/wall-transport', () => ({ createWallTransport: () => mockTransport }));
jest.mock('@/lib/files/photos', () => ({ captureFileUri: (path: string) => `file:///documents/${path}` }));
jest.mock('react-native-gesture-handler', () => ({ GestureHandlerRootView: jest.requireActual('react-native').View }));
jest.mock('react-native-reanimated', () => ({ isSharedValue: () => false }));
jest.mock('./view-mode-picker', () => ({ ViewModePicker: () => null }));
jest.mock('./wall-gallery', () => {
  const { View, Pressable, Text } = jest.requireActual('react-native');
  return {
    WallArtwork: () => null,
    WallGallery: ({ pieces, onSelect, children }: { pieces: { localId: string; artwork: { title: string } }[];
      onSelect: (piece: unknown) => void; children: ReactNode }) => <View>{pieces.map((piece) =>
        <Pressable key={piece.localId} accessibilityRole="button" onPress={() => onSelect(piece)}><Text>{piece.artwork.title}</Text></Pressable>)}{children}</View>,
  };
});
jest.mock('@expo/ui', () => ({
  ...jest.requireActual('../../../__mocks__/@expo/ui'),
  Picker: Object.assign(() => null, { Item: () => null }), Slider: () => null,
}));
jest.mock('expo-router', () => {
  const { View, Pressable, Text } = jest.requireActual('react-native');
  return { useRouter: () => ({ push: mockPush }), Stack: {
    Toolbar: Object.assign(View, { Button: ({ children, hidden, disabled, onPress }: {
      children: ReactNode; hidden: boolean; disabled: boolean; onPress: () => void;
    }) => hidden ? null : <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}><Text>{children}</Text></Pressable> }),
  } };
});

const published: OwnerWall = { scope: 'scope-a', profileId: 'profile-a' as never, revision: 3, color: '#CDD0CA', items: [{
  itemId: 'item-a' as never, saveLocalId: 'save-a', noteVisible: false, noteRevision: 0, noteEligible: true,
  layout: { x: 0.1, y: 0.2, width: 0.4, frame: 'gilt', layer: 0 },
  artwork: { title: 'The Milkmaid', artist: 'Johannes Vermeer', media: { kind: 'placeholder', width: 1, height: 1 } },
}] };

beforeEach(() => {
  jest.clearAllMocks(); mockToken = 'token'; switchOwner('account:a', 'scope-a');
  mockTransport.getMine.mockResolvedValue(published);
  mockTransport.listMine.mockResolvedValue({ page: [{ localId: 'save-b', snapshot: { title: 'Sunflowers', artist: 'Vincent van Gogh' } }], cursor: null, isDone: true });
  mockTransport.setLayout.mockImplementation(async (input: Parameters<WallTransport['setLayout']>[0]) => ({ ...published, ...input, revision: 4,
    items: input.items.map((item) => ({ ...published.items[0], ...item })) }));
});

async function openWall() {
  const view = await render(<CollectionWall works={[]} onModeChange={jest.fn()} />);
  await fireEvent(screen.getByLabelText('Collection wall'), 'layout', { nativeEvent: { layout: { width: 393, height: 440 } } });
  await screen.findByRole('button', { name: 'The Milkmaid' });
  return view;
}

it('gives guests a sign-in action without requesting or publishing a wall', async () => {
  mockToken = null; switchOwner('device:guest', 'guest-scope');
  const onModeChange = jest.fn();
  await render(<CollectionWall works={[]} onModeChange={onModeChange} />);
  await fireEvent(screen.getByLabelText('Collection wall'), 'layout', { nativeEvent: { layout: { width: 393 } } });
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  expect(mockPush).toHaveBeenCalledWith('/settings');
  await fireEvent.press(screen.getByRole('button', { name: 'All artworks' }));
  expect(onModeChange).toHaveBeenCalledWith('grid');
  expect(mockTransport.getMine).not.toHaveBeenCalled();
  expect(mockTransport.setLayout).not.toHaveBeenCalled();
});

it('keeps additions and removals in a draft until Publish, and Cancel restores the wall', async () => {
  await openWall();
  await fireEvent.press(screen.getByRole('button', { name: 'Edit' }));
  await fireEvent.press(screen.getByRole('button', { name: 'The Milkmaid' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Take off wall' }));
  expect(screen.queryByRole('button', { name: 'The Milkmaid' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Add artwork' }));
  await screen.findByText('Sunflowers');
  await fireEvent.press(screen.getByRole('button', { name: 'Hang' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
  expect(screen.getByRole('button', { name: 'Sunflowers' })).toBeOnTheScreen();
  expect(mockTransport.setLayout).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('button', { name: 'The Milkmaid' })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Sunflowers' })).toBeNull();
});

it('reloads the synced collection each time the add sheet opens while keeping hung artwork', async () => {
  await openWall();
  await fireEvent.press(screen.getByRole('button', { name: 'Edit' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Add artwork' }));
  await screen.findByText('Sunflowers');
  await fireEvent.press(screen.getByRole('button', { name: 'Hang' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
  mockTransport.listMine.mockResolvedValue({ page: [{ localId: 'save-c', snapshot: { title: 'Irises', artist: 'Vincent van Gogh' } }], cursor: null, isDone: true });
  await fireEvent.press(screen.getByRole('button', { name: 'Add artwork' }));
  expect(await screen.findByText('Irises')).toBeOnTheScreen();
  expect(mockTransport.listMine).toHaveBeenLastCalledWith({ scope: 'scope-a', cursor: undefined }, expect.anything());
  expect(screen.getByRole('button', { name: 'Sunflowers' })).toBeOnTheScreen();
  expect(screen.getAllByRole('button', { name: 'Hang' })).toHaveLength(1);
});

it('publishes color, frame, and placement together using the acknowledged revision', async () => {
  await openWall();
  await fireEvent.press(screen.getByRole('button', { name: 'Edit' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Wall color' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Burgundy' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
  await fireEvent.press(screen.getByRole('button', { name: 'The Milkmaid' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Baroque' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Right' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Publish' }));
  await screen.findByRole('button', { name: 'Edit' });
  expect(mockTransport.setLayout).toHaveBeenCalledWith({ scope: 'scope-a', revision: 3, color: '#6C2F2B',
    items: [{ saveLocalId: 'save-a', layout: { ...published.items[0].layout, x: 0.125, frame: 'baroque' } }] }, expect.anything());
  expect(mockTransport.setNoteVisibility).not.toHaveBeenCalled();
});

it('keeps an unpublished edit after a network failure so it can be retried', async () => {
  await openWall();
  mockTransport.setLayout.mockRejectedValueOnce(new Error('Network request failed'));
  await fireEvent.press(screen.getByRole('button', { name: 'Edit' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Publish' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/Your wall was not published/);
  expect(screen.getByRole('button', { name: 'Publish' })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Publish' }));
  expect(await screen.findByRole('button', { name: 'Edit' })).toBeOnTheScreen();
});

it('shows the empty wall instead of a spinner while the account scope is still missing', async () => {
  switchOwner('account:a');
  await render(<CollectionWall works={[]} onModeChange={jest.fn()} />);
  await fireEvent(screen.getByLabelText('Collection wall'), 'layout', { nativeEvent: { layout: { width: 393 } } });
  expect(screen.queryByText('Opening your wall…')).toBeNull();
  expect(screen.getByRole('button', { name: 'Load wall' })).toBeOnTheScreen();
  expect(mockTransport.getMine).not.toHaveBeenCalled();
});

it('treats a missing profile on refresh as a state rather than an error', async () => {
  mockTransport.getMine.mockRejectedValue(new ConvexError({ code: 'profile_required' }));
  const { result } = await renderHook(() => useCollectionWall([]));
  await waitFor(() => expect(result.current.profileRequired).toBe(true));
  await act(() => result.current.refresh());
  expect(result.current.profileRequired).toBe(true);
  expect(result.current.error).toBeUndefined();
  expect(result.current.loading).toBe(false);
});

it('does not reload the wall when only the auth token rotates', async () => {
  const { result, rerender } = await renderHook(() => useCollectionWall([]));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(mockTransport.getMine).toHaveBeenCalledTimes(1);
  mockToken = 'rotated-token';
  await rerender(undefined);
  expect(result.current.loading).toBe(false);
  expect(mockTransport.getMine).toHaveBeenCalledTimes(1);
});

it('offers profile creation when the account has no public profile', async () => {
  mockTransport.getMine.mockRejectedValue(new ConvexError({ code: 'profile_required' }));
  await render(<CollectionWall works={[]} onModeChange={jest.fn()} />);
  await fireEvent(screen.getByLabelText('Collection wall'), 'layout', { nativeEvent: { layout: { width: 393 } } });
  expect(await screen.findByRole('button', { name: 'Create your wall' })).toBeOnTheScreen();
});

it('opens published artwork in the visitor preview without changing note visibility', async () => {
  await openWall();
  await fireEvent.press(screen.getByRole('button', { name: 'View as visitor' }));
  await fireEvent.press(screen.getAllByRole('button', { name: 'The Milkmaid' }).at(-1)!);
  expect(screen.getByText('Johannes Vermeer')).toBeOnTheScreen();
  expect(mockTransport.setNoteVisibility).not.toHaveBeenCalled();
});

it('clears a rendered wall immediately when its owner changes', async () => {
  await openWall();
  await act(() => { mockToken = null; switchOwner('device:guest', 'guest-scope'); });
  expect(screen.queryByRole('button', { name: 'The Milkmaid' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeOnTheScreen();
});

it.each([false, true])('loads local draft artwork proportions, tolerating a missing photo (%s)', async (missing) => {
  const getSize = jest.spyOn(Image, 'getSize').mockImplementation(async () => {
    if (missing) throw new Error('File missing');
    return { width: 600, height: 900 };
  });
  try {
    const works = [{ localId: 'save-b', cropPath: 'crops/sunflowers.jpg', title: 'Sunflowers', artist: 'Vincent van Gogh' }] as SavedWork[];
    const { result } = await renderHook(() => useCollectionWall(works));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.loadSelections());
    await act(() => result.current.repository.setLayoutDraft({ color: '#CDD0CA', items: [
      { saveLocalId: 'save-b', layout: published.items[0].layout },
    ] }));
    expect(result.current.pieces[0].artwork.title).toBe('Sunflowers');
    expect(wallAspect(result.current.pieces[0])).toBeCloseTo(missing ? 1 : 600 / 900);
    expect(mockTransport.setLayout).not.toHaveBeenCalled();
  } finally { getSize.mockRestore(); }
});
