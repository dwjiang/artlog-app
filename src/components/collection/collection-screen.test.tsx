import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { Id } from '../../../convex/_generated/dataModel';

import { CollectionScreen } from './collection-screen';
import { anonymousOwner, switchOwner } from '@/lib/account/owner-store';
import { insertSavedWork } from '@/db/repos/saved-works';
import { upsertVisit } from '@/db/repos/visits';

const mockHrefs: unknown[] = [];
jest.mock('@expo/ui/swift-ui', () => jest.requireActual('../../../__mocks__/@expo/ui/swift-ui'));
jest.mock('../visits/globe-canvas', () => ({ GlobeCanvas: () => null }));
jest.mock('@/lib/venue/venue-db', () => ({ venueMetadataForIds: async () => [], onVenueMetadataChange: () => () => {} }));

jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
jest.mock('@/lib/files/photos', () => ({ captureFileUri: (path: string) => `file:///documents/${path}` }));
jest.mock('expo-router', () => {
  const { Pressable, TextInput, View, Text } = jest.requireActual('react-native');
  return {
    router: { push: jest.fn() },
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
jest.mock('./view-mode-picker', () => {
  const { Pressable, Text, View } = jest.requireActual('react-native');
  return {
    ViewModePicker: ({ mode, onChange }: { mode: string; onChange: (mode: string) => void }) => (
      <View>
        {['wall', 'grid', 'az', 'visits'].map((value) => (
          <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: mode === value }} onPress={() => onChange(value)}>
            <Text>{value}</Text>
          </Pressable>
        ))}
      </View>
    ),
  };
});


jest.mock('./collection-wall', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return { CollectionWall: ({ onModeChange }: { onModeChange: (mode: string) => void }) => (
    <Pressable accessibilityRole="button" onPress={() => onModeChange('grid')}><Text>All artworks</Text></Pressable>
  ) };
});

async function renderArchive() {
  await render(<CollectionScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'All artworks' }));
}

it('starts on the wall and opens the full collection separately', async () => {
  await render(<CollectionScreen />);
  expect(screen.getByRole('button', { name: 'All artworks' })).toBeOnTheScreen();
  expect(screen.queryByPlaceholderText('Title, artist, date or place')).toBeNull();
});

const venueId = 'museum-1' as Id<'museums'>;
const search = () => screen.getByPlaceholderText(/Title, artist, date or place|Search your visits/);

beforeEach(() => { mockHrefs.length = 0; });

it('invites the first scan while the collection is empty', async () => {
  await renderArchive();
  expect(await screen.findByText('Scan a painting to start your collection.')).toBeOnTheScreen();
  expect(screen.getByRole('link', { name: 'Go to Scan' })).toBeOnTheScreen();
  expect(mockHrefs).toEqual(['/']);
});

describe('with saved works', () => {
  beforeAll(async () => {
    await upsertVisit({ visitedOn: '2026-09-08', timeZone: 'UTC', localId: '7e5de765-90f8-5015-b60d-2652d64b650f', venueId, venueName: 'Metropolitan Museum of Art', startedAt: new Date(2026, 8, 8, 14).getTime() });
    await upsertVisit({ visitedOn: '2026-09-01', timeZone: 'UTC', localId: 'b00e1cd6-0fef-559f-88cc-0b73a2c7ae58', venueId, venueName: 'de Young', startedAt: new Date(2026, 8, 1, 11).getTime() });
    await insertSavedWork({ localId: 'lilies', visitLocalId: '7e5de765-90f8-5015-b60d-2652d64b650f', venueId, savedAt: 3, title: 'Water Lilies', artist: 'Claude Monet', institution: "Musée d'Orsay", cropPath: 'crops/lilies.jpg' });
    await insertSavedWork({ localId: 'cotton', visitLocalId: 'b00e1cd6-0fef-559f-88cc-0b73a2c7ae58', venueId, savedAt: 2, title: '100% Cotton', artist: 'Anon', institution: 'de Young', cropPath: 'crops/cotton.jpg' });
    await insertSavedWork({ localId: 'import', savedAt: 1, title: 'Untitled', artist: 'Unknown', cropPath: 'crops/import.jpg' });
  });

  it('shows every work in the grid, newest first, each linking to its detail', async () => {
    await renderArchive();
    expect(await screen.findByRole('button', { name: 'Water Lilies, Claude Monet' })).toBeOnTheScreen();
    expect(screen.getAllByRole('button', { name: /, / }).map((cell) => cell.props.accessibilityLabel)).toEqual([
      'Water Lilies, Claude Monet', '100% Cotton, Anon', 'Untitled, Unknown',
    ]);
    expect(mockHrefs).toContainEqual({ pathname: '/[savedId]', params: { savedId: 'lilies' } });
    expect(screen.getByText('Water Lilies')).toBeOnTheScreen();
    expect(screen.getByText('Claude Monet')).toBeOnTheScreen();
  });

  it('narrows the grid with the header search and explains an empty match', async () => {
    await renderArchive();
    await screen.findByRole('button', { name: 'Water Lilies, Claude Monet' });
    await fireEvent.changeText(search(), 'MONET');
    expect(screen.getAllByRole('button', { name: /, / })).toHaveLength(1);
    // The header search bar keeps its text across the archive views, so the filter must too.
    await fireEvent.press(screen.getByRole('button', { name: 'az' }));
    expect(screen.getAllByRole('button', { name: /, / })).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: 'grid' }));
    await fireEvent.changeText(search(), 'orsay');
    expect(screen.getByRole('button', { name: 'Water Lilies, Claude Monet' })).toBeOnTheScreen();
    await fireEvent.changeText(search(), 'vermeer ');
    expect(screen.getByText('No works match “vermeer”.')).toBeOnTheScreen();
    await fireEvent.changeText(search(), '');
    expect(screen.getAllByRole('button', { name: /, / })).toHaveLength(3);
  });

  it('opens a visit timeline with whole visits and keeps imports in All artworks', async () => {
    await renderArchive();
    await screen.findByRole('button', { name: 'Water Lilies, Claude Monet' });
    await fireEvent.press(screen.getByRole('button', { name: 'visits' }));
    await fireEvent.press(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByText('Metropolitan Museum of Art')).toBeOnTheScreen();
    expect(screen.getByText('de Young')).toBeOnTheScreen();
    expect(screen.queryByText('Imported')).toBeNull();
    expect(mockHrefs).toContainEqual({ pathname: '/visit/[visitId]', params: { visitId: '7e5de765-90f8-5015-b60d-2652d64b650f' } });
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
  await renderArchive();
  await screen.findByText('Scan a painting to start your collection.');
  await fireEvent.press(screen.getByRole('button', { name: 'visits' }));
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
  await fireEvent.press(screen.getByRole('button', { name: 'az' }));
  expect(screen.getAllByRole('button', { name: /, / }).map((row) => row.props.accessibilityLabel)).toEqual([
    '100% Cotton, Anon', 'Water Lilies, Claude Monet', 'Untitled, Unknown',
  ]);
});
