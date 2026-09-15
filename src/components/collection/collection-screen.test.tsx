import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { Id } from '../../../convex/_generated/dataModel';

import { CollectionScreen } from './collection-screen';
import { anonymousOwner, switchOwner } from '@/lib/account/owner-store';
import { insertSavedWork } from '@/db/repos/saved-works';
import { upsertVisit } from '@/db/repos/visits';

const mockHrefs: unknown[] = [];
jest.mock('@/lib/venue/venue-db', () => ({ venueMetadataForIds: async () => [], onVenueMetadataChange: () => () => {} }));

jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
jest.mock('@/lib/files/photos', () => ({ captureFileUri: (path: string) => `file:///documents/${path}` }));
jest.mock('expo-router', () => {
  const { Pressable, TextInput } = jest.requireActual('react-native');
  return {
    Link: ({ href, asChild, children }: { href: unknown; asChild?: boolean; children: ReactNode }) => {
      mockHrefs.push(href);
      return asChild ? children : <Pressable accessibilityRole="link">{children}</Pressable>;
    },
    Stack: {
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
        {['grid', 'canvas', 'az', 'visits'].map((value) => (
          <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: mode === value }} onPress={() => onChange(value)}>
            <Text>{value}</Text>
          </Pressable>
        ))}
      </View>
    ),
  };
});

const venueId = 'museum-1' as Id<'museums'>;
const search = () => screen.getByPlaceholderText(/Title, artist, date or place|Museum, place or visit date/);

beforeEach(() => { mockHrefs.length = 0; });

it('invites the first scan while the collection is empty', async () => {
  await render(<CollectionScreen />);
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
    await render(<CollectionScreen />);
    expect(await screen.findByRole('button', { name: 'Water Lilies, Claude Monet' })).toBeOnTheScreen();
    expect(screen.getAllByRole('button', { name: /, / }).map((cell) => cell.props.accessibilityLabel)).toEqual([
      'Water Lilies, Claude Monet', '100% Cotton, Anon', 'Untitled, Unknown',
    ]);
    expect(mockHrefs).toContainEqual({ pathname: '/[savedId]', params: { savedId: 'lilies' } });
    expect(screen.getByText('Water Lilies')).toBeOnTheScreen();
    expect(screen.getByText('Claude Monet')).toBeOnTheScreen();
  });

  it('narrows the grid with the header search and explains an empty match', async () => {
    await render(<CollectionScreen />);
    await screen.findByRole('button', { name: 'Water Lilies, Claude Monet' });
    await fireEvent.changeText(search(), 'MONET');
    expect(screen.getAllByRole('button', { name: /, / })).toHaveLength(1);
    await fireEvent.changeText(search(), 'orsay');
    expect(screen.getByRole('button', { name: 'Water Lilies, Claude Monet' })).toBeOnTheScreen();
    await fireEvent.changeText(search(), 'vermeer ');
    expect(screen.getByText('No works match “vermeer”.')).toBeOnTheScreen();
    await fireEvent.changeText(search(), '');
    expect(screen.getAllByRole('button', { name: /, / })).toHaveLength(3);
  });

  it('groups works by visit, newest first, with imports last', async () => {
    await render(<CollectionScreen />);
    await screen.findByRole('button', { name: 'Water Lilies, Claude Monet' });
    await fireEvent.press(screen.getByRole('button', { name: 'visits' }));
    const headers = ['Metropolitan Museum of Art · 8 Sep 2026', 'de Young · 1 Sep 2026', 'Imported'];
    for (const title of headers) expect(screen.getByText(title)).toBeOnTheScreen();
    expect(screen.getAllByText('1 work')).toHaveLength(3);
    await fireEvent.changeText(search(), 'cotton');
    expect(screen.queryByText(headers[0])).toBeNull();
    expect(screen.getByText(headers[1])).toBeOnTheScreen();
  });

  it('hangs the works on the canvas wall', async () => {
    await render(<CollectionScreen />);
    await screen.findByRole('button', { name: 'Water Lilies, Claude Monet' });
    await fireEvent.press(screen.getByRole('button', { name: 'canvas' }));
    expect(screen.getByRole('button', { name: 'canvas' })).toBeSelected();
    expect(screen.getAllByRole('button', { name: /, / })).toHaveLength(3);
    expect(screen.getByText('100% Cotton')).toBeOnTheScreen();
  });
});

it('immediately hides account works on sign-out and restores them on sign-in', async () => {
  await insertSavedWork({ localId: 'account-work', savedAt: 10, title: 'Private account work', artist: 'Reader' }, 'account:a');
  switchOwner('account:a', 'scope-a');
  await render(<CollectionScreen />);
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
  await screen.findByText('Scan a painting to start your collection.');
  await fireEvent.press(screen.getByRole('button', { name: 'visits' }));
  expect(screen.getByText('February 2024')).toBeOnTheScreen();
  expect(screen.getByText('Empty Museum · 29 Feb 2024')).toBeOnTheScreen();
  expect(screen.getByText('No artworks saved on this visit.')).toBeOnTheScreen();
  await fireEvent.changeText(search(), '2024-02-29');
  expect(screen.getByText('Empty Museum · 29 Feb 2024')).toBeOnTheScreen();
  await fireEvent.changeText(search(), 'missing');
  expect(screen.getByText('No visits match “missing”.')).toBeOnTheScreen();
});
it('shows the A–Z collection in artist order', async () => {
  switchOwner(anonymousOwner(), 'scope-anonymous');
  await render(<CollectionScreen />);
  await screen.findByText('Water Lilies');
  await fireEvent.press(screen.getByRole('button', { name: 'az' }));
  expect(screen.getAllByRole('button', { name: /, / }).map((row) => row.props.accessibilityLabel)).toEqual([
    '100% Cotton, Anon', 'Water Lilies, Claude Monet', 'Untitled, Unknown',
  ]);
});
