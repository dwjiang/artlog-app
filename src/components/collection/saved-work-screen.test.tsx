import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ConvexProvider, ConvexReactClient } from 'convex/react';
import { getFunctionName } from 'convex/server';
import { ConvexError } from 'convex/values';
import { Alert, type AlertButton } from 'react-native';

import type { Id } from '../../../convex/_generated/dataModel';

import { SavedWorkScreen } from './saved-work-screen';
import { getNote, setNote } from '@/db/repos/notes';
import { getSavedWork, insertSavedWork } from '@/db/repos/saved-works';

const mockBack = jest.fn();
const mockAuth = { isAuthenticated: true };
let client: ConvexReactClient;
const results = new Map<string, unknown>();
const listeners = new Set<() => void>();

jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/lib/files/photos', () => ({ captureFileUri: (path: string) => `file:///documents/${path}` }));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }));
jest.mock('convex/react', () => ({
  ...jest.requireActual('convex/react'),
  useConvexAuth: () => mockAuth,
}));
jest.mock('@expo/ui/swift-ui', () => {
  const { Pressable, Text, View } = jest.requireActual('react-native');
  return {
    Host: View,
    Button: ({ label, onPress }: { label: string; onPress: () => void }) => (
      <Pressable accessibilityRole="button" onPress={onPress}><Text>{label}</Text></Pressable>
    ),
  };
});

const enrichment = {
  docent: [{ sentence: 'Monet painted this pond at Giverny in 1916.', factIds: ['f1'] }],
  factSheet: [{ id: 'f1', sourceUrl: 'https://www.wikidata.org/wiki/Q1', sourceLabel: 'Wikidata' }],
  rightsStatus: 'public_domain',
};

beforeAll(async () => {
  await insertSavedWork({
    localId: 'lilies', savedAt: new Date(2026, 8, 8, 14).getTime(), title: 'Water Lilies', artist: 'Claude Monet', date: '1916',
    medium: 'Oil on canvas', institution: "Musée d'Orsay", venueName: 'Metropolitan Museum of Art', gallery: 'Gallery 819',
    artworkId: 'artwork-1' as Id<'artworks'>, photoPath: 'photos/lilies.jpg', cropPath: 'crops/lilies.jpg',
  });
  await insertSavedWork({ localId: 'plain', savedAt: new Date(2026, 8, 9).getTime(), title: 'Untitled', artist: 'Unknown', cropPath: 'crops/plain.jpg' });
});

beforeEach(() => {
  jest.resetAllMocks();
  mockAuth.isAuthenticated = true;
  results.clear();
  listeners.clear();
  results.set('devices:me', { deviceId: 'device-1', attested: false, trustWeight: 1 });
  results.set('artworks:enrichment', enrichment);
  client = new ConvexReactClient('https://test.convex.cloud', { logger: false });
  jest.spyOn(client, 'watchQuery').mockImplementation((...[query]: Parameters<ConvexReactClient['watchQuery']>) => ({
    localQueryResult: () => {
      const result = results.get(getFunctionName(query));
      if (result instanceof Error) throw result;
      return result;
    },
    onUpdate: (callback) => {
      listeners.add(callback);
      return () => { listeners.delete(callback); };
    },
    localQueryLogs: () => undefined,
    journal: () => undefined,
  }));
});
afterEach(async () => {
  await client.close();
  jest.restoreAllMocks();
});

function detail(savedId: string) {
  return <ConvexProvider client={client}><SavedWorkScreen savedId={savedId} /></ConvexProvider>;
}

it('shows the snapshot as text, with the note as the only input', async () => {
  await render(detail('lilies'));
  expect(await screen.findByText('Water Lilies')).toBeOnTheScreen();
  for (const value of ['Claude Monet', '1916', 'Oil on canvas', "Musée d'Orsay", 'Seen at Metropolitan Museum of Art · 8 Sep 2026 · Gallery 819']) {
    expect(screen.getByText(value)).toBeOnTheScreen();
  }
  expect(screen.queryByDisplayValue('Water Lilies')).toBeNull();
  expect(screen.queryByDisplayValue('Claude Monet')).toBeNull();
  expect(screen.getByLabelText('Notes')).toBeOnTheScreen();
  expect(screen.getByLabelText('Your photo of Water Lilies').props.source).toEqual([{ uri: 'file:///documents/photos/lilies.jpg' }]);
});

it('saves the note on blur', async () => {
  await render(detail('lilies'));
  const input = await screen.findByLabelText('Notes');
  await waitFor(() => expect(input).toBeEnabled());
  await fireEvent.changeText(input, 'Seen with Sam');
  await fireEvent(input, 'blur');
  expect(await getNote('lilies')).toMatchObject({ text: 'Seen with Sam' });
});

it('shows the saved note when the work is opened again', async () => {
  await setNote('lilies', 'Seen with Sam and Ana');
  await render(detail('lilies'));
  expect(await screen.findByDisplayValue('Seen with Sam and Ana')).toBeOnTheScreen();
});

it('renders the artwork enrichment when the backend has it', async () => {
  await render(detail('lilies'));
  expect(await screen.findByText('About this work')).toBeOnTheScreen();
  expect(screen.getByText('Monet painted this pond at Giverny in 1916.')).toBeOnTheScreen();
  expect(screen.getByRole('link', { name: 'Wikidata' })).toBeOnTheScreen();
  expect(client.watchQuery).toHaveBeenCalledWith(expect.anything(), { artworkId: 'artwork-1' }, {});
});

it('skips the enrichment query for a work saved without an artwork', async () => {
  await render(detail('plain'));
  expect(await screen.findByText('Untitled')).toBeOnTheScreen();
  expect(screen.getByText('Saved 9 Sep 2026')).toBeOnTheScreen();
  expect(screen.queryByText('About this work')).toBeNull();
  expect(client.watchQuery).not.toHaveBeenCalled();
});

it('waits for authentication and device registration while showing the local snapshot', async () => {
  mockAuth.isAuthenticated = false;
  results.set('devices:me', null);
  const view = await render(detail('lilies'));
  expect(await screen.findByText('Water Lilies')).toBeOnTheScreen();
  expect(client.watchQuery).not.toHaveBeenCalled();

  mockAuth.isAuthenticated = true;
  await view.rerender(detail('lilies'));
  expect(screen.queryByText('About this work')).toBeNull();
  expect(jest.mocked(client.watchQuery).mock.calls.every(([query]) => getFunctionName(query) === 'devices:me')).toBe(true);

  await act(() => {
    results.set('devices:me', { deviceId: 'device-1', attested: false, trustWeight: 1 });
    for (const listener of listeners) listener();
  });
  expect(await screen.findByText('About this work')).toBeOnTheScreen();
  mockAuth.isAuthenticated = false;
  await view.rerender(detail('lilies'));
  expect(screen.queryByText('About this work')).toBeNull();
  expect(screen.getByText('Water Lilies')).toBeOnTheScreen();
});

it.each(['devices:me', 'artworks:enrichment'])('keeps local detail usable and recovers after %s fails', async (query) => {
  const success = results.get(query);
  results.set(query, new ConvexError({ code: 'unauthenticated' }));
  await render(detail('lilies'));
  expect(await screen.findByText('Water Lilies')).toBeOnTheScreen();
  expect(screen.getByLabelText('Your photo of Water Lilies')).toBeOnTheScreen();
  const input = screen.getByLabelText('Notes');
  await waitFor(() => expect(input).toBeEnabled());
  await fireEvent.changeText(input, 'Still editable without enrichment');
  await fireEvent(input, 'blur');
  expect(await getNote('lilies')).toMatchObject({ text: 'Still editable without enrichment' });
  expect(screen.getByRole('button', { name: 'Delete' })).toBeOnTheScreen();

  await act(() => {
    results.set(query, success);
    for (const listener of listeners) listener();
  });
  expect(await screen.findByText('Monet painted this pond at Giverny in 1916.')).toBeOnTheScreen();
});

it('deletes only after confirmation and then goes back', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await render(detail('plain'));
  await fireEvent.press(await screen.findByRole('button', { name: 'Delete' }));
  expect(alert).toHaveBeenCalledWith('Delete this work?', expect.any(String), expect.any(Array));
  const buttons = alert.mock.calls[0][2] as AlertButton[];
  expect(buttons.map((button) => button.text)).toEqual(['Cancel', 'Delete']);
  expect((await getSavedWork('plain'))?.deletedAt).toBeNull();
  await act(async () => { buttons[1].onPress?.(); });
  expect((await getSavedWork('plain'))?.deletedAt).toEqual(expect.any(Number));
  expect(mockBack).toHaveBeenCalledTimes(1);
});
