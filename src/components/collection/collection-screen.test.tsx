import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { Id } from '../../../convex/_generated/dataModel';

import { AllArtworksScreen } from './all-artworks-screen';
import { CollectionScreen } from './collection-screen';
import { anonymousOwner, switchOwner } from '@/lib/account/owner-store';
import { insertSavedWork } from '@/db/repos/saved-works';
import { upsertVisit } from '@/db/repos/visits';
import { removeSetting } from '@/db/repos/settings';

jest.mock('./collection-header', () => ({ CollectionHeader: () => null }));
jest.mock('@/lib/wall/use-collection-wall', () => ({ useCollectionWall: () => ({ signedIn: false, draft: null }) }));
jest.mock('@/lib/social/use-social-session', () => ({ useSocialSession: () => ({ status: 'signed-out', key: 'guest' }) }));
jest.mock('@/lib/social/use-social-query', () => ({ useSocialQuery: () => ({}) }));
jest.mock('@/lib/account/use-account', () => ({ useAccount: () => ({ account: { linked: false }, available: true, ready: true }) }));
jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationButtonType: { SIGN_IN: 0 }, AppleAuthenticationButtonStyle: { BLACK: 0 },
  AppleAuthenticationButton: () => null,
}));
const mockHrefs: unknown[] = [];
jest.mock('@expo/ui/swift-ui', () => jest.requireActual('../../../__mocks__/@expo/ui/swift-ui'));
jest.mock('../visits/globe-canvas', () => ({ GlobeCanvas: () => null }));
jest.mock('@/lib/venue/venue-db', () => ({ venueMetadataForIds: async () => [], onVenueMetadataChange: () => () => {} }));

jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
jest.mock('@/lib/files/photos', () => ({ captureFileUri: (path: string) => `file:///documents/${path}` }));
jest.mock('expo-router', () => {
  const { Pressable, TextInput, View, Text } = jest.requireActual('react-native');
  return {
    router: { push: jest.fn() }, useFocusEffect: () => {},
    Link: ({ href, asChild, children }: { href: unknown; asChild?: boolean; children: ReactNode }) => {
      mockHrefs.push(href);
      return asChild ? children : <Pressable accessibilityRole="link">{children}</Pressable>;
    },
    Stack: {
      Toolbar: Object.assign(View, { Button: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => <Pressable accessibilityRole="button" onPress={onPress}><Text>{children}</Text></Pressable> }),
      SearchBar: ({ placeholder, onChangeText }: { placeholder: string; onChangeText: (event: { nativeEvent: { text: string } }) => void }) => (
        <TextInput placeholder={placeholder} onChangeText={(text: string) => onChangeText({ nativeEvent: { text } })} />
      ),
    },
  };
});
jest.mock('./collection-wall', () => {
  const { Text, View } = jest.requireActual('react-native');
  return { CollectionWall: ({ header, controls }: { header: ReactNode; controls: ReactNode }) => <View>{header}{controls}<Text>Collection wall</Text></View> };
});
async function renderArchive() { await render(<AllArtworksScreen />); }

it('opens the local artwork collection for guests without a sign-in gate', async () => {
  await render(<CollectionScreen />);
  expect(await screen.findByText('Your collection begins here.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Artworks' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Visits' })).toBeOnTheScreen();
  expect(screen.queryByText('Collection wall')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  expect(screen.queryByText('Keep your collection across devices')).toBeNull();
});

const venueId = 'museum-1' as Id<'museums'>;
const search = () => screen.getByPlaceholderText(/Title, artist, date or place|Search your visits/);

beforeEach(async () => { mockHrefs.length = 0; switchOwner(anonymousOwner(), 'scope-anonymous'); await removeSetting('sync-prompt-dismissed'); });

it('keeps the public wall as the account collection view', async () => {
  switchOwner('account:a', 'scope-a');
  await render(<CollectionScreen />);
  expect(screen.getByText('Collection wall')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Wall' })).toBeOnTheScreen();
  expect(screen.queryByText('Keep your collection across devices')).toBeNull();
});

it('invites the first scan while the collection is empty', async () => {
  await renderArchive();
  expect(await screen.findByText('Your collection begins here.')).toBeOnTheScreen();
  expect(screen.getByText('Scan a painting to save your first artwork.')).toBeOnTheScreen();
});

it('offers sync on returning after the first save and keeps the artwork accessible', async () => {
  switchOwner('device:first-save', 'scope-first-save');
  const empty = await render(<CollectionScreen />);
  expect(await screen.findByText('Your collection begins here.')).toBeOnTheScreen();
  expect(screen.queryByText('Keep your collection across devices')).toBeNull();
  await empty.unmount();
  await act(async () => { await insertSavedWork({ localId: 'first-artwork', savedAt: 1, title: 'First artwork', artist: 'First artist' }); });
  await render(<CollectionScreen />);
  expect(await screen.findByText('Keep your collection across devices')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'First artwork, First artist' })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
  expect(screen.getByRole('button', { name: 'First artwork, First artist' })).toBeOnTheScreen();
});

describe('with saved works', () => {
  beforeAll(async () => {
    switchOwner(anonymousOwner(), 'scope-anonymous');
    await upsertVisit({ visitedOn: '2026-09-08', timeZone: 'UTC', localId: '7e5de765-90f8-5015-b60d-2652d64b650f', venueId, venueName: 'Metropolitan Museum of Art', startedAt: new Date(2026, 8, 8, 14).getTime() });
    await upsertVisit({ visitedOn: '2026-09-01', timeZone: 'UTC', localId: 'b00e1cd6-0fef-559f-88cc-0b73a2c7ae58', venueId, venueName: 'de Young', startedAt: new Date(2026, 8, 1, 11).getTime() });
    await insertSavedWork({ localId: 'lilies', visitLocalId: '7e5de765-90f8-5015-b60d-2652d64b650f', venueId, savedAt: 3, title: 'Water Lilies', artist: 'Claude Monet', institution: "Musée d'Orsay", cropPath: 'crops/lilies.jpg' });
    await insertSavedWork({ localId: 'cotton', visitLocalId: 'b00e1cd6-0fef-559f-88cc-0b73a2c7ae58', venueId, savedAt: 2, title: '100% Cotton', artist: 'Anon', institution: 'de Young', cropPath: 'crops/cotton.jpg' });
    await insertSavedWork({ localId: 'import', savedAt: 1, title: 'Untitled', artist: 'Unknown', cropPath: 'crops/import.jpg' });
  });

  it('shows every work in artist order, each linking to its detail', async () => {
    await renderArchive();
    expect(await screen.findByRole('button', { name: 'Water Lilies, Claude Monet' })).toBeOnTheScreen();
    expect(screen.getAllByRole('button', { name: /, / }).map((cell) => cell.props.accessibilityLabel)).toEqual([
      '100% Cotton, Anon', 'Water Lilies, Claude Monet', 'Untitled, Unknown',
    ]);
    expect(mockHrefs).toContainEqual({ pathname: '/saved/[savedId]', params: { savedId: 'lilies' } });
    expect(screen.getByText('Water Lilies')).toBeOnTheScreen();
    expect(screen.getByText('Claude Monet')).toBeOnTheScreen();
  });

  it('narrows the grid with the header search and explains an empty match', async () => {
    await renderArchive();
    await screen.findByRole('button', { name: 'Water Lilies, Claude Monet' });
    await fireEvent.changeText(search(), 'MONET');
    expect(screen.getAllByRole('button', { name: /, / })).toHaveLength(1);
    await fireEvent.changeText(search(), 'orsay');
    expect(screen.getByRole('button', { name: 'Water Lilies, Claude Monet' })).toBeOnTheScreen();
    await fireEvent.changeText(search(), 'vermeer ');
    expect(screen.getByText('No artworks found.')).toBeOnTheScreen();
    await fireEvent.changeText(search(), '');
    expect(screen.getAllByRole('button', { name: /, / })).toHaveLength(3);
  });

  it('shows saved art directly for guests and retains artwork search across visit browsing', async () => {
    await render(<CollectionScreen />);
    expect(await screen.findByRole('button', { name: 'Water Lilies, Claude Monet' })).toBeOnTheScreen();
    expect(await screen.findByText('Keep your collection across devices')).toBeOnTheScreen();
    await fireEvent.changeText(search(), 'Monet');
    expect(screen.queryByText('100% Cotton')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Visits' }));
    await fireEvent.press(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByText('de Young')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Artworks' }));
    expect(search()).toHaveDisplayValue('Monet');
    expect(screen.getByText('Water Lilies')).toBeOnTheScreen();
    expect(screen.queryByText('100% Cotton')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Clear search' }));
    expect(search()).toHaveDisplayValue('');
    expect(screen.getByText('100% Cotton')).toBeOnTheScreen();
  });

  it('opens a visit timeline with whole visits and keeps imports in All artworks', async () => {
    await render(<CollectionScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Visits' }));
    await fireEvent.press(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByText('Metropolitan Museum of Art')).toBeOnTheScreen();
    expect(screen.getByText('de Young')).toBeOnTheScreen();
    expect(screen.queryByText('Imported')).toBeNull();
    expect(mockHrefs).toContainEqual({ pathname: '/journal/[visitId]', params: { visitId: '7e5de765-90f8-5015-b60d-2652d64b650f' } });
    await fireEvent.changeText(search(), 'cotton');
    expect(screen.queryByText('Metropolitan Museum of Art')).toBeNull();
    expect(screen.getByText('de Young')).toBeOnTheScreen();
  });


});

it('immediately hides account works on sign-out and restores them on sign-in', async () => {
  await insertSavedWork({ localId: 'account-work', savedAt: 10, title: 'Private account work', artist: 'Reader' }, 'account:a');
  switchOwner('account:a', 'scope-a');
  await renderArchive();
  expect(await screen.findByText('Private account work')).toBeOnTheScreen();
  await act(() => switchOwner(anonymousOwner(), 'scope-anonymous'));
  expect(screen.queryByText('Private account work')).toBeNull();
  await act(() => switchOwner('account:a', 'scope-a2'));
  expect(await screen.findByText('Private account work')).toBeOnTheScreen();
});

it('shows empty visits and calendar month groups, and searches them by country or date', async () => {
  switchOwner('account:empty', 'scope-empty');
  await upsertVisit({ localId: '00000000-0000-4000-8000-000000000001', venueId, venueName: 'Empty Museum', visitedOn: '2024-02-29', timeZone: 'UTC' });
  await render(<CollectionScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Visits' }));
  await fireEvent.press(screen.getByRole('button', { name: 'List' }));
  expect(screen.getByText('February 2024')).toBeOnTheScreen();
  expect(screen.getByText('Empty Museum')).toBeOnTheScreen();
  expect(screen.getByText('Location unavailable · 0 artworks')).toBeOnTheScreen();
  await fireEvent.changeText(search(), '2024-02-29');
  expect(screen.getByText('Empty Museum')).toBeOnTheScreen();
  await fireEvent.changeText(search(), 'missing');
  expect(screen.getByText('No visits match “missing”.')).toBeOnTheScreen();
});
it('shows the A–Z collection in artist order', async () => {
  switchOwner(anonymousOwner(), 'scope-anonymous');
  await renderArchive();
  await screen.findByText('Water Lilies');
  expect(screen.getAllByRole('button', { name: /, / }).map((row) => row.props.accessibilityLabel)).toEqual([
    '100% Cotton, Anon', 'Water Lilies, Claude Monet', 'Untitled, Unknown',
  ]);
});
