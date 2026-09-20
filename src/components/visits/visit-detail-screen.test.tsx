import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { renderRouter } from 'expo-router/testing-library';
import { DeviceEventEmitter, Text } from 'react-native';
import type { VisitSummary } from '@/lib/journal/visit-summaries';
import * as visits from '@/db/repos/visits';
import { switchOwner } from '@/lib/account/owner-store';
import { VisitDetailScreen } from './visit-detail-screen';

const mockVisit = {
  visibility: 'public', syncedAt: null, localId: 'visit', owner: 'device:test-installation', venueName: 'Museum',
  visitedOn: '2024-02-29', location: 'New York', reflection: 'The afternoon light', startedAt: 1, endedAt: 5,
  works: [{ localId: 'painting', title: 'Water Lilies', artist: 'Claude Monet', cropPath: null }],
} as VisitSummary;
const mockLoad = jest.fn();
const mockFlush = jest.fn();
jest.mock('@/lib/account/collection-sync', () => ({ flushJournal: () => mockFlush() }));
let mockPublication: { status: string; audience: 'public' } | null = null;
jest.mock('@/lib/journal/use-visits', () => ({
  useVisits: () => ({ owner: mockVisit.owner, visits: [mockVisit], loading: false }),
}));
jest.mock('@/lib/visits/use-visit-sharing', () => ({
  useVisitSharing: () => ({ controller: { load: mockLoad }, token: null, acknowledged: mockPublication }),
}));
jest.mock('../loading-ring', () => ({ LoadingRing: () => null }));
jest.mock('../collection/saved-work-image', () => ({ SavedWorkImage: () => null }));
const mockMarkSeen = jest.fn();
jest.mock('@/lib/journal/visit-seen', () => ({ markVisitSeen: (...args: unknown[]) => mockMarkSeen(...args) }));

afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
beforeEach(() => { mockPublication = null; mockVisit.owner = 'device:test-installation'; mockVisit.endedAt = 5; mockVisit.visibility = 'public'; mockVisit.syncedAt = null;
  mockLoad.mockClear(); mockFlush.mockReset().mockResolvedValue(undefined); switchOwner(mockVisit.owner); });

it('shows Public on a published visit', async () => {
  mockVisit.owner = 'account:test-account';
  mockPublication = { status: 'active', audience: 'public' };
  await renderRouter({ _layout: () => <Stack />, 'journal/[visitId]': VisitDetailScreen }, { initialUrl: '/journal/visit' });
  expect(screen.getByRole('button', { name: 'Public visit. Make private.' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Save visit' })).toBeOnTheScreen();
});

it('opens saved artwork from a visit and returns to its private notes', async () => {
  const navigation = renderRouter({
    _layout: () => <Stack />,
    'journal/[visitId]': VisitDetailScreen,
    'saved/[savedId]': () => <Text>Saved painting</Text>,
  }, { initialUrl: '/journal/visit' });
  await navigation;
  expect(screen.getByDisplayValue('The afternoon light')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('link', { name: 'Water Lilies, Claude Monet' }));
  await waitFor(() => expect(navigation.getPathname()).toBe('/saved/painting'));
  expect(screen.getByText('Saved painting')).toBeOnTheScreen();
  await act(() => router.back());
  expect(navigation.getPathname()).toBe('/journal/visit');
  expect(screen.getByDisplayValue('The afternoon light')).toBeOnTheScreen();
});

it('edits notes directly on the visit without navigating away', async () => {
  const navigation = renderRouter({ _layout: () => <Stack />, 'journal/[visitId]': VisitDetailScreen }, { initialUrl: '/journal/visit' });
  await navigation;
  expect(screen.getByRole('header', { name: 'Notes' })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Edit note' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Add a note' })).toBeNull();
  expect(navigation.getPathname()).toBe('/journal/visit');
  expect(screen.getByLabelText('Notes')).toHaveProp('value', 'The afternoon light');
  expect(screen.getByRole('link', { name: 'Water Lilies, Claude Monet' })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Save note' })).toBeNull();
  expect(navigation.getPathname()).toBe('/journal/visit');
  expect(screen.getByDisplayValue('The afternoon light')).toBeOnTheScreen();
});

it('saves the latest note when navigating to an artwork before autosave runs', async () => {
  const save = jest.spyOn(visits, 'patchVisit').mockResolvedValue(undefined);
  const navigation = renderRouter({
    _layout: () => <Stack />,
    'journal/[visitId]': VisitDetailScreen,
    'saved/[savedId]': () => <Text>Saved painting</Text>,
  }, { initialUrl: '/journal/visit' });
  await navigation;
  await fireEvent.changeText(screen.getByLabelText('Notes'), 'A new memory');
  await fireEvent.press(screen.getByRole('link', { name: 'Water Lilies, Claude Monet' }));
  await waitFor(() => expect(navigation.getPathname()).toBe('/saved/painting'));
  expect(save).toHaveBeenCalledWith('visit', { reflection: 'A new memory' }, mockVisit.owner, { sync: true });
});

it('shows search immediately and keeps it visible after clearing the filter', async () => {
  await renderRouter({ _layout: () => <Stack />, 'journal/[visitId]': VisitDetailScreen }, { initialUrl: '/journal/visit' });
  expect(screen.getByPlaceholderText('Search this visit')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Search visit artworks' })).toBeNull();
  await fireEvent.changeText(screen.getByLabelText('Search visit artworks'), 'Monet');
  expect(screen.getByRole('link', { name: 'Water Lilies, Claude Monet' })).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText('Search visit artworks'), 'unmatched');
  expect(screen.queryByRole('link', { name: 'Water Lilies, Claude Monet' })).toBeNull();
  expect(screen.getByText('No artworks match this search.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Clear search' }));
  expect(screen.getByRole('link', { name: 'Water Lilies, Claude Monet' })).toBeOnTheScreen();
  expect(screen.getByLabelText('Search visit artworks')).toHaveProp('value', '');
  expect(screen.getByPlaceholderText('Search this visit')).toBeOnTheScreen();
});

it('marks a closed visit as seen once it is opened, but not one still in progress', async () => {
  await renderRouter({ _layout: () => <Stack />, 'journal/[visitId]': VisitDetailScreen }, { initialUrl: '/journal/visit' });
  expect(mockMarkSeen).toHaveBeenCalledWith('visit', 'device:test-installation');
  mockMarkSeen.mockClear();
  mockVisit.endedAt = null;
  await renderRouter({ _layout: () => <Stack />, 'journal/[visitId]': VisitDetailScreen }, { initialUrl: '/journal/visit' });
  expect(mockMarkSeen).not.toHaveBeenCalled();
});

it('defaults to Public before publishing and opens the preview only from Save visit', async () => {
  const navigation = renderRouter({
    _layout: () => <Stack />,
    'journal/[visitId]': VisitDetailScreen,
    'visit-share/[visitId]/index': () => <Text>Publish preview</Text>,
  }, { initialUrl: '/journal/visit' });
  await navigation;
  expect(screen.getByRole('button', { name: 'Public visit. Make private.' })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Share visit' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Save visit' }));
  await waitFor(() => expect(navigation.getPathname()).toBe('/visit-share/visit'));
});

it('saves Private for a guest directly without opening sharing', async () => {
  const save = jest.spyOn(visits, 'patchVisit').mockResolvedValue(undefined);
  const navigation = renderRouter({ _layout: () => <Stack />, 'journal/[visitId]': VisitDetailScreen }, { initialUrl: '/journal/visit' });
  await navigation;
  await fireEvent.press(screen.getByRole('button', { name: 'Public visit. Make private.' }));
  expect(save).toHaveBeenCalledWith('visit', { visibility: 'private' }, mockVisit.owner);
  expect(mockFlush).not.toHaveBeenCalled();
  expect(navigation.getPathname()).toBe('/journal/visit');
});

it('preserves a saved Private choice and toggles Public without publishing', async () => {
  mockVisit.visibility = 'private';
  const save = jest.spyOn(visits, 'patchVisit').mockResolvedValue(undefined);
  const navigation = renderRouter({ _layout: () => <Stack />, 'journal/[visitId]': VisitDetailScreen }, { initialUrl: '/journal/visit' });
  await navigation;
  expect(screen.getByText('Saved privately')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Save visit' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Private visit. Make public.' }));
  expect(save).toHaveBeenCalledWith('visit', { visibility: 'public' }, mockVisit.owner);
  expect(navigation.getPathname()).toBe('/journal/visit');
});

it('syncs the entire published visit becoming Private before refreshing publication state', async () => {
  mockVisit.owner = 'account:test-account'; switchOwner(mockVisit.owner);
  mockPublication = { status: 'active', audience: 'public' };
  const save = jest.spyOn(visits, 'patchVisit').mockResolvedValue(undefined);
  await renderRouter({ _layout: () => <Stack />, 'journal/[visitId]': VisitDetailScreen }, { initialUrl: '/journal/visit' });
  await fireEvent.press(screen.getByRole('button', { name: 'Public visit. Make private.' }));
  await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(1));
  expect(save).toHaveBeenCalledWith('visit', { visibility: 'private' }, mockVisit.owner);
  expect(mockFlush).toHaveBeenCalledTimes(1);
});

it('warns when a privacy change cannot sync and retries without toggling again', async () => {
  mockVisit.owner = 'account:test-account'; switchOwner(mockVisit.owner);
  const save = jest.spyOn(visits, 'patchVisit').mockResolvedValue(undefined);
  mockFlush.mockRejectedValueOnce(new Error('Offline'));
  await renderRouter({ _layout: () => <Stack />, 'journal/[visitId]': VisitDetailScreen }, { initialUrl: '/journal/visit' });
  await fireEvent.press(screen.getByRole('button', { name: 'Public visit. Make private.' }));
  expect(screen.getByRole('alert')).toHaveTextContent(/A published visit may still be visible\./);
  await fireEvent.press(screen.getByRole('button', { name: 'Retry visibility' }));
  await waitFor(() => expect(mockFlush).toHaveBeenCalledTimes(2));
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls.map((call) => call[1])).toEqual([{ visibility: 'private' }, { visibility: 'private' }]);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('releases the visibility control if an offline sync never finishes', async () => {
  jest.useFakeTimers();
  mockVisit.owner = 'account:test-account'; switchOwner(mockVisit.owner);
  jest.spyOn(visits, 'patchVisit').mockResolvedValue(undefined);
  mockFlush.mockReturnValueOnce(new Promise(() => {}));
  await renderRouter({ _layout: () => <Stack />, 'journal/[visitId]': VisitDetailScreen }, { initialUrl: '/journal/visit' });
  await fireEvent.press(screen.getByRole('button', { name: 'Public visit. Make private.' }));
  expect(screen.getByRole('button', { name: 'Public visit. Make private.' })).toBeDisabled();
  await act(() => jest.advanceTimersByTime(30_000));
  expect(screen.getByRole('button', { name: 'Retry visibility' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Public visit. Make private.' })).toBeEnabled();
});


it('hides the bottom actions while editing and restores them after the keyboard closes', async () => {
  await renderRouter({ _layout: () => <Stack />, 'journal/[visitId]': VisitDetailScreen }, { initialUrl: '/journal/visit' });
  expect(screen.getByRole('button', { name: 'Save visit' })).toBeOnTheScreen();
  const keyboard = { duration: 250, easing: 'keyboard', endCoordinates: { screenX: 0, screenY: 500, width: 390, height: 300 } };
  await act(() => DeviceEventEmitter.emit('keyboardWillShow', keyboard));
  expect(screen.queryByRole('button', { name: 'Save visit' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Public visit. Make private.' })).toBeNull();
  expect(screen.getByLabelText('Notes')).toBeOnTheScreen();
  expect(screen.getByPlaceholderText('Search this visit')).toBeOnTheScreen();
  await act(() => DeviceEventEmitter.emit('keyboardDidHide', keyboard));
  expect(screen.getByRole('button', { name: 'Save visit' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Public visit. Make private.' })).toBeOnTheScreen();
});

it('saves pending notes before opening the Save visit flow', async () => {
  const save = jest.spyOn(visits, 'patchVisit').mockResolvedValue(undefined);
  const navigation = renderRouter({
    _layout: () => <Stack />,
    'journal/[visitId]': VisitDetailScreen,
    'visit-share/[visitId]/index': () => <Text>Publish preview</Text>,
  }, { initialUrl: '/journal/visit' });
  await navigation;
  await fireEvent.changeText(screen.getByLabelText('Notes'), 'Remember the blue room');
  await fireEvent.press(screen.getByRole('button', { name: 'Save visit' }));
  await waitFor(() => expect(navigation.getPathname()).toBe('/visit-share/visit'));
  expect(save).toHaveBeenCalledWith('visit', { reflection: 'Remember the blue room' }, mockVisit.owner, { sync: true });
});

it('keeps a pending Private sync distinct from a completed private save', async () => {
  mockVisit.owner = 'account:test-account'; mockVisit.visibility = 'private';
  mockPublication = { status: 'active', audience: 'public' };
  await renderRouter({ _layout: () => <Stack />, 'journal/[visitId]': VisitDetailScreen }, { initialUrl: '/journal/visit' });
  expect(screen.getByText('Waiting to sync')).toBeOnTheScreen();
  expect(screen.getByText('Waiting to sync. The published visit is still visible.')).toBeOnTheScreen();
  expect(screen.queryByText('Saved privately')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Save visit' })).toBeNull();
});
