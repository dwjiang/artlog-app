import { fireEvent, render, screen } from '@testing-library/react-native';
import { LinkArtworkScreen } from './link-artwork-screen';
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
const mockPush = jest.fn(), mockDismiss = jest.fn(), mockDismissAll = jest.fn(), mockLink = jest.fn(), mockToast = jest.fn();
jest.mock('@/lib/ui/toast', () => ({ showToast: (...args: unknown[]) => mockToast(...args) }));
let mockEmpty = false;
let mockParams: { savedId?: string; visitId?: string };
jest.mock('@/lib/account/owner-store', () => ({ useLocalOwner: () => 'device:guest' }));
jest.mock('@/db/repos/artwork-album', () => ({ selectArtworkEncounters: () => [], linkArtworkVisits: (...args: unknown[]) => mockLink(...args), linkArtworksVisit: (...args: unknown[]) => mockLink(...args) }));
jest.mock('@/db/repos/saved-works', () => ({ listSavedWorks: () => mockEmpty ? [] : [
  { owner: 'device:guest', localId: 'garden', title: 'Garden', artist: 'Monet', cropPath: 'garden.jpg' },
  { owner: 'device:guest', localId: 'night', title: 'Night', artist: 'Van Gogh', cropPath: 'night.jpg' },
] }));
jest.mock('@/db/repos/visits', () => ({ listVisits: () => mockEmpty ? [] : [
  { owner: 'device:guest', localId: 'paris', venueName: 'Musée d’Orsay', visitedOn: '2026-09-01' },
] }));
jest.mock('drizzle-orm/expo-sqlite', () => ({ useLiveQuery: (data: unknown) => ({ data, updatedAt: new Date() }) }));
jest.mock('./saved-work-image', () => ({ SavedWorkImage: ({ title }: { title: string }) => {
  const { View } = jest.requireActual('react-native'); return <View accessibilityRole="image" accessibilityLabel={title} />;
} }));
jest.mock('expo-router', () => ({ router: { navigate: (...args: unknown[]) => mockPush(...args), push: (...args: unknown[]) => mockPush(...args), dismissTo: (...args: unknown[]) => mockDismiss(...args), dismissAll: () => mockDismissAll() }, useLocalSearchParams: () => mockParams, Stack: {
  Screen: () => null, SearchBar: ({ placeholder, onChangeText }: { placeholder: string; onChangeText: (event: unknown) => void }) => {
    const { TextInput } = jest.requireActual('react-native');
    return <TextInput accessibilityLabel={placeholder} onChangeText={(text: string) => onChangeText({ nativeEvent: { text } })} />;
  },
} }));
beforeEach(() => { jest.clearAllMocks(); mockEmpty = false; mockParams = { savedId: 'garden' }; });
it('keeps new-visit creation available even when the search has no matching visits', async () => {
  await render(<LinkArtworkScreen />);
  await fireEvent.changeText(screen.getByLabelText('Search visits'), 'missing');
  expect(screen.queryByRole('button', { name: 'Link Musée d’Orsay' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Add a new visit' }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/visit-create', params: { savedId: 'garden' } });
  expect(mockLink).not.toHaveBeenCalled();
});
it('searches artworks by artist, shows their photos, and returns in the linked visit context', async () => {
  mockParams = { visitId: 'paris' };
  await render(<LinkArtworkScreen />);
  await fireEvent.changeText(screen.getByLabelText('Search artworks'), 'monet');
  expect(screen.getByLabelText('Garden')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Link Night' })).toBeNull();
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Select Garden' }));
  expect(mockLink).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Link 1 artwork' }));
  expect(mockLink).toHaveBeenCalledWith(['garden'], 'paris', 'device:guest');
  expect(mockDismiss).toHaveBeenCalledWith({ pathname: '/journal/[visitId]', params: { visitId: 'paris' } });
});


it('carries the chosen visit from an empty artwork picker into Scan', async () => {
  mockEmpty = true; mockParams = { visitId: 'paris' };
  await render(<LinkArtworkScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Scan artwork' }));
  expect(mockDismissAll).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/scan', params: { visitId: 'paris' } });
  expect(mockLink).not.toHaveBeenCalled();
});

it('creates a visit for the selected artwork when no visits exist', async () => {
  mockEmpty = true;
  await render(<LinkArtworkScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Add visit' }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/visit-create', params: { savedId: 'garden' } });
});

it('links multiple selected artworks only after confirmation', async () => {
  mockParams = { visitId: 'paris' };
  await render(<LinkArtworkScreen />);
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Select Garden' }));
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Select Night' }));
  expect(mockLink).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Link 2 artworks' }));
  expect(mockLink).toHaveBeenCalledWith(['garden', 'night'], 'paris', 'device:guest');
});

it('links the selected visits to the artwork in one batch and names a single visit in the singular', async () => {
  await render(<LinkArtworkScreen />);
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Select Musée d’Orsay' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Link 1 visit' }));
  expect(mockLink).toHaveBeenCalledWith('garden', ['paris'], 'device:guest');
  expect(mockToast).toHaveBeenCalledWith('1 visit linked.');
  expect(mockDismiss).toHaveBeenCalledWith({ pathname: '/saved/[savedId]', params: { savedId: 'garden' } });
});
