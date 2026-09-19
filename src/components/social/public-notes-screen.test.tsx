import { fireEvent, render, screen } from '@testing-library/react-native';
import { getFunctionName as mockFunctionName } from 'convex/server';
import { PublicNotesScreen } from './public-notes-screen';
const mockSetDraft = jest.fn(), mockPublish = jest.fn(), mockGallery = jest.fn(), mockToast = jest.fn();
const layout = { x: 0.1, y: 0.2, width: 0.4, layer: 0, frame: 'gilt' };
const media = { kind: 'placeholder', width: 1, height: 1 };
const mockWall = {
  signedIn: true, loading: false, acknowledged: { profileId: 'reader', color: '#45524B', items: [
    { itemId: 'a', layout, artwork: { artist: 'Artist A', title: 'One', media }, privateNote: 'A selected thought', noteEligible: true, noteVisible: true },
    { itemId: 'b', layout: { ...layout, y: 1, layer: 1 }, artwork: { artist: 'Artist B', title: 'Two', media }, privateNote: 'An unselected secret', noteEligible: true, noteVisible: false },
  ] }, noteDraft: [] as { itemId: string; visible: boolean }[], repository: { setNoteDraft: mockSetDraft, publishNotes: mockPublish }, setError: jest.fn(),
};
jest.mock('@expo/ui');
jest.mock('@expo/ui/swift-ui');
jest.mock('@/lib/ui/toast', () => ({ showToast: (...args: unknown[]) => mockToast(...args) }));
jest.mock('expo-router', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  const Toolbar = ({ children }: { children: React.ReactNode }) => children;
  Toolbar.Button = function ToolbarButton({ children, onPress, disabled }: { children: string; onPress: () => void; disabled?: boolean }) {
    return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}><Text>{children}</Text></Pressable>;
  };
  return { router: { push: jest.fn() }, Stack: { Toolbar } };
});
jest.mock('@/lib/wall/use-collection-wall', () => ({ useCollectionWall: () => mockWall }));
jest.mock('@/lib/social/use-social-session', () => ({ useSocialSession: () => ({ key: 'reader' }) }));
jest.mock('@/lib/social/use-social-query', () => ({ useSocialQuery: (query: Parameters<typeof mockFunctionName>[0]) => ({
  data: mockFunctionName(query) === 'profiles:getPublic' ? { name: 'Reader', username: 'reader', publishedWallCount: 2 } : undefined,
}) }));
jest.mock('../collection/wall-gallery', () => ({ WallGallery: (props: { pieces: { localId: string; artwork: { title: string } }[]; onSelect: (piece: unknown) => void }) => {
  mockGallery(props);
  const { Pressable, Text, View } = jest.requireActual('react-native');
  return <View>{props.pieces.map((piece) => <Pressable key={piece.localId} accessibilityRole="button" onPress={() => props.onSelect(piece)}><Text>{piece.artwork.title}</Text></Pressable>)}</View>;
} }));
jest.mock('react-native-gesture-handler', () => ({ GestureHandlerRootView: jest.requireActual('react-native').View }));
jest.mock('expo-image', () => ({ Image: (props: object) => { const { View } = jest.requireActual('react-native'); return <View {...props} />; } }));
beforeEach(() => { jest.clearAllMocks(); mockWall.noteDraft = []; });
async function openWall() {
  await fireEvent.press(screen.getByRole('button', { name: 'Preview' }));
  await fireEvent(screen.getByLabelText('Public collection wall'), 'layout', { nativeEvent: { layout: { width: 390 } } });
}
it('previews the full visitor wall and reveals only selected notes when opening artwork', async () => {
  await render(<PublicNotesScreen />);
  expect(screen.getByText('An unselected secret')).toBeOnTheScreen();
  await openWall();
  expect(screen.getByText('Reader')).toBeOnTheScreen();
  expect(screen.getByLabelText('Public collection wall')).toBeOnTheScreen();
  expect(mockGallery).toHaveBeenLastCalledWith(expect.objectContaining({ color: '#45524B', pieces: [
    expect.objectContaining({ localId: 'a', layout }), expect.objectContaining({ localId: 'b' }),
  ] }));
  await fireEvent.press(screen.getByRole('button', { name: 'One' }));
  expect(screen.getByText('A selected thought')).toBeOnTheScreen();
  expect(screen.queryByText('An unselected secret')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Back to wall' }));
  await fireEvent(screen.getByLabelText('Public collection wall'), 'layout', { nativeEvent: { layout: { width: 390 } } });
  await fireEvent.press(screen.getByRole('button', { name: 'Two' }));
  expect(screen.queryByText('An unselected secret')).toBeNull();
  expect(screen.queryByText('Shared note')).toBeNull();
  expect(mockPublish).not.toHaveBeenCalled();
});
it('applies unsaved choices in preview, keeps them on return, and publishes only on save', async () => {
  const view = await render(<PublicNotesScreen />);
  await fireEvent.press(screen.getAllByRole('switch', { name: 'Show note on public wall' })[1]);
  expect(mockSetDraft).toHaveBeenCalledWith([{ itemId: 'b', visible: true }]);
  mockWall.noteDraft = [{ itemId: 'a', visible: false }, { itemId: 'b', visible: true }];
  await view.rerender(<PublicNotesScreen />);
  await openWall();
  await fireEvent.press(screen.getByRole('button', { name: 'Two' }));
  expect(screen.getByText('An unselected secret')).toBeOnTheScreen();
  expect(screen.queryByText('A selected thought')).toBeNull();
  expect(mockPublish).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Back to wall' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Edit' }));
  expect(screen.getAllByRole('switch', { name: 'Show note on public wall' })[1]).toHaveProp('accessibilityState', expect.objectContaining({ checked: true }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  expect(mockPublish).toHaveBeenCalledTimes(1);
  expect(mockToast).toHaveBeenCalledWith('Your note choices are saved.');
});
