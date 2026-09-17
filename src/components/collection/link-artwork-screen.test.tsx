import { fireEvent, render, screen } from '@testing-library/react-native';
import { LinkArtworkScreen } from './link-artwork-screen';
const mockPush = jest.fn(), mockDismiss = jest.fn(), mockLink = jest.fn();
let mockParams: { savedId?: string; visitId?: string };
jest.mock('@/lib/account/owner-store', () => ({ useLocalOwner: () => 'device:guest' }));
jest.mock('@/db/repos/artwork-album', () => ({ selectArtworkEncounters: () => [], linkArtworkVisit: (...args: unknown[]) => mockLink(...args) }));
jest.mock('@/db/repos/saved-works', () => ({ listSavedWorks: () => [
  { owner: 'device:guest', localId: 'garden', title: 'Garden', artist: 'Monet', cropPath: 'garden.jpg' },
  { owner: 'device:guest', localId: 'night', title: 'Night', artist: 'Van Gogh', cropPath: 'night.jpg' },
] }));
jest.mock('@/db/repos/visits', () => ({ listVisits: () => [
  { owner: 'device:guest', localId: 'paris', venueName: 'Musée d’Orsay', visitedOn: '2026-09-01' },
] }));
jest.mock('drizzle-orm/expo-sqlite', () => ({ useLiveQuery: (data: unknown) => ({ data }) }));
jest.mock('./saved-work-image', () => ({ SavedWorkImage: ({ title }: { title: string }) => {
  const { View } = jest.requireActual('react-native'); return <View accessibilityRole="image" accessibilityLabel={title} />;
} }));
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args), dismissTo: (...args: unknown[]) => mockDismiss(...args) }, useLocalSearchParams: () => mockParams, Stack: {
  Screen: () => null, SearchBar: ({ placeholder, onChangeText }: { placeholder: string; onChangeText: (event: unknown) => void }) => {
    const { TextInput } = jest.requireActual('react-native');
    return <TextInput accessibilityLabel={placeholder} onChangeText={(text: string) => onChangeText({ nativeEvent: { text } })} />;
  },
} }));
beforeEach(() => { jest.clearAllMocks(); mockParams = { savedId: 'garden' }; });
it('keeps new-visit creation available even when the search has no matching visits', async () => {
  await render(<LinkArtworkScreen />);
  await fireEvent.changeText(screen.getByLabelText('Museum or visit date'), 'missing');
  expect(screen.queryByRole('button', { name: 'Link Musée d’Orsay' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Add a new visit' }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/visit-create', params: { savedId: 'garden' } });
  expect(mockLink).not.toHaveBeenCalled();
});
it('searches artworks by artist, shows their photos, and returns in the linked visit context', async () => {
  mockParams = { visitId: 'paris' };
  await render(<LinkArtworkScreen />);
  await fireEvent.changeText(screen.getByLabelText('Title or artist'), 'monet');
  expect(screen.getByLabelText('Garden')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Link Night' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Link Garden' }));
  expect(mockLink).toHaveBeenCalledWith('garden', 'paris', 'device:guest');
  expect(mockDismiss).toHaveBeenCalledWith({ pathname: '/[savedId]', params: { savedId: 'garden', visitId: 'paris' } });
});
