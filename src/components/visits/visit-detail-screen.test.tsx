import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { renderRouter } from 'expo-router/testing-library';
import { Alert, DeviceEventEmitter, Pressable, Text } from 'react-native';
import type { VisitSummary } from '@/lib/journal/visit-summaries';
import * as visits from '@/db/repos/visits';
import { switchOwner } from '@/lib/account/owner-store';
import { VisitDetailScreen } from './visit-detail-screen';

jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  const React = jest.requireActual('react');
  const { View, Text, Pressable } = jest.requireActual('react-native');
  const MenuAction = ({ children, disabled, onPress }: { children: string; disabled?: boolean; onPress: () => void }) => <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}><Text>{children}</Text></Pressable>;
  return { ...actual, Stack: Object.assign((props: object) => React.createElement(actual.Stack, props), actual.Stack, { Toolbar: Object.assign(View, { Menu: View, MenuAction }) }) };
});
async function makePrivate() {
  await fireEvent.press(screen.getByRole('button', { name: 'Make private' }));
  const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2];
  await act(() => buttons?.find((button) => button.style === 'destructive')?.onPress?.());
}
const mockVisit = {
  visibility: 'public', syncedAt: null, localId: 'visit', owner: 'device:test-installation', venueName: 'Museum',
  visitedOn: '2024-02-29', location: 'New York', reflection: 'The afternoon light', startedAt: 1, endedAt: 5,
  works: [{ localId: 'painting', title: 'Water Lilies', artist: 'Claude Monet', cropPath: null }],
} as VisitSummary;
const mockEnd = jest.fn();
jest.mock('@/lib/venue/use-venue', () => ({ useVenue: () => ({ end: mockEnd }) }));
const mockToast = jest.fn();
jest.mock('@/lib/ui/toast', () => ({ showToast: (...args: unknown[]) => mockToast(...args) }));
const mockLoad = jest.fn();
const mockFlush = jest.fn();
jest.mock('@/lib/account/collection-sync', () => ({ flushJournal: () => mockFlush() }));
let mockSharingBusy = false;
let mockPublication: { status: string; audience: 'public' } | null = null;
jest.mock('@/lib/journal/use-visits', () => ({
  useVisits: () => ({ owner: mockVisit.owner, visits: [mockVisit], loading: false }),
}));
jest.mock('@/lib/visits/use-visit-sharing', () => ({
  useVisitSharing: () => ({ controller: { load: mockLoad }, token: null, acknowledged: mockPublication, busy: mockSharingBusy }),
}));
jest.mock('../loading-ring', () => ({ LoadingRing: () => null }));
jest.mock('../collection/saved-work-image', () => ({ SavedWorkImage: () => null }));
const mockMarkSeen = jest.fn();
jest.mock('@/lib/journal/visit-seen', () => ({ markVisitSeen: (...args: unknown[]) => mockMarkSeen(...args) }));

afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
beforeEach(() => { mockSharingBusy = false; jest.spyOn(Alert, 'alert').mockImplementation(() => {}); mockVisit.works = [{ localId: 'painting', title: 'Water Lilies', artist: 'Claude Monet', cropPath: null }] as VisitSummary['works']; mockPublication = null; mockVisit.owner = 'device:test-installation'; mockVisit.endedAt = 5; mockVisit.visibility = 'public'; mockVisit.syncedAt = null;
  mockEnd.mockReset().mockResolvedValue(undefined); mockToast.mockClear(); mockLoad.mockClear(); mockFlush.mockReset().mockResolvedValue(undefined); switchOwner(mockVisit.owner); });

it('opens sign-in directly above a guest visit and preserves the visit when dismissed', async () => {
  const navigation = renderRouter({
    _layout: () => <Stack />,
    'journal/[visitId]': VisitDetailScreen,
    'sign-in': () => <Text>Share your museum visit.</Text>,
  }, { initialUrl: '/journal/visit' });
  await navigation;
  await fireEvent.press(screen.getByRole('button', { name: 'Prepare to share' }));
  await waitFor(() => expect(navigation.getPathname()).toBe('/sign-in'));
  expect(navigation.getSearchParams()).toMatchObject({ context: 'visit', visitId: 'visit' });
  await act(() => router.back());
  expect(navigation.getPathname()).toBe('/journal/visit');
  expect(screen.getByText('The afternoon light')).toBeOnTheScreen();
});

it('shows Public on a published visit', async () => {
  mockVisit.owner = 'account:test-account';
  mockPublication = { status: 'active', audience: 'public' };
  await renderRouter({ _layout: () => <Stack />, 'journal/[visitId]': VisitDetailScreen }, { initialUrl: '/journal/visit' });
  expect(screen.getByRole('button', { name: 'Make private' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Prepare to share' })).toBeOnTheScreen();
});

it('opens saved artwork from a visit and returns to its private notes', async () => {
  const navigation = renderRouter({
    _layout: () => <Stack />,
    'journal/[visitId]': VisitDetailScreen,
    'saved/[savedId]': () => <Text>Saved painting</Text>,
  }, { initialUrl: '/journal/visit' });
  await navigation;
  expect(screen.queryByText(/Private on this device/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Prepare to share' })).toBeOnTheScreen();
  expect(screen.getByText('The afternoon light')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('link', { name: 'Water Lilies, Claude Monet' }));
  await waitFor(() => expect(navigation.getPathname()).toBe('/saved/painting'));
  expect(screen.getByText('Saved painting')).toBeOnTheScreen();
  await act(() => router.back());
  expect(navigation.getPathname()).toBe('/journal/visit');
  expect(screen.getByText('The afternoon light')).toBeOnTheScreen();
});

it('edits notes directly on the visit without navigating away', async () => {
  const navigation = renderRouter({ _layout: () => <Stack />, 'journal/[visitId]': VisitDetailScreen }, { initialUrl: '/journal/visit' });
  await navigation;
  expect(screen.getByRole('header', { name: 'Notes' })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Edit note' }));
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
  await fireEvent.press(screen.getByRole('button', { name: 'Edit note' }));
  await fireEvent.changeText(screen.getByLabelText('Notes'), 'A new memory');
  await fireEvent.press(screen.getByRole('link', { name: 'Water Lilies, Claude Monet' }));
  await waitFor(() => expect(navigation.getPathname()).toBe('/saved/painting'));
  expect(save).toHaveBeenCalledWith('visit', { reflection: 'A new memory' }, mockVisit.owner, { sync: true });
});

it('shows search for a larger visit and keeps it visible after clearing the filter', async () => {
  mockVisit.works = [...mockVisit.works, ...Array.from({ length: 8 }, (_, i) => ({ ...mockVisit.works[0], localId: `extra-${i}`, title: `Other ${i}`, artist: 'Other' }))];
  await renderRouter({ _layout: () => <Stack />, 'journal/[visitId]': VisitDetailScreen }, { initialUrl: '/journal/visit' });
  expect(screen.getByPlaceholderText('Search this visit')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Search visit artworks' })).toBeNull();
  await fireEvent.changeText(screen.getByLabelText('Search visit artworks'), 'Monet');
  expect(screen.getByRole('link', { name: 'Water Lilies, Claude Monet' })).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText('Search visit artworks'), 'unmatched');
  expect(screen.queryByRole('link', { name: 'Water Lilies, Claude Monet' })).toBeNull();
  expect(screen.getByText('No artworks found.')).toBeOnTheScreen();
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

it('defaults to Public before publishing and opens the preview only from Save', async () => {
  mockVisit.owner = 'account:test-account'; switchOwner(mockVisit.owner);
  const navigation = renderRouter({
    _layout: () => <Stack />,
    'journal/[visitId]': VisitDetailScreen,
    'visit-share/[visitId]/index': () => <Text>Publish preview</Text>,
  }, { initialUrl: '/journal/visit' });
  await navigation;
  expect(screen.getByRole('button', { name: 'Make private' })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Share visit' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Prepare to share' }));
  await waitFor(() => expect(navigation.getPathname()).toBe('/visit-share/visit'));
});

it('saves Private for a guest directly without opening sharing', async () => {
  const save = jest.spyOn(visits, 'patchVisit').mockResolvedValue(undefined);
  const navigation = renderRouter({ _layout: () => <Stack />, 'journal/[visitId]': VisitDetailScreen }, { initialUrl: '/journal/visit' });
  await navigation;
  await makePrivate();
  expect(save).toHaveBeenCalledWith('visit', { visibility: 'private' }, mockVisit.owner);
  expect(mockFlush).not.toHaveBeenCalled();
  expect(navigation.getPathname()).toBe('/journal/visit');
});

it('keeps a private visit readable and offers saving without changing its visibility', async () => {
  mockVisit.visibility = 'private'; mockVisit.syncedAt = 1;
  const save = jest.spyOn(visits, 'patchVisit').mockResolvedValue(undefined);
  await renderRouter({ _layout: () => <Stack />, 'journal/[visitId]': VisitDetailScreen }, { initialUrl: '/journal/visit' });
  expect(screen.getByText('Private visit')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Save' })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Make private' })).toBeNull();
  expect(save).not.toHaveBeenCalled();
});

it('does not call a new unsynced private visit a pending privacy change', async () => {
  mockVisit.owner = 'account:test-account'; mockVisit.visibility = 'private'; mockVisit.syncedAt = null;
  await renderRouter({ _layout: () => <Stack />, 'journal/[visitId]': VisitDetailScreen }, { initialUrl: '/journal/visit' });
  expect(screen.getByText('Private visit')).toBeOnTheScreen();
  expect(screen.getByText('You choose what to share before anything is published.')).toBeOnTheScreen();
  expect(screen.queryByText(/waiting to sync/i)).toBeNull();
});

it('does not claim a published visit is private while its privacy change is awaiting sync', async () => {
  mockVisit.owner = 'account:test-account';
  mockVisit.visibility = 'private';
  mockVisit.syncedAt = null;
  mockPublication = { status: 'active', audience: 'public' };
  await renderRouter({ _layout: () => <Stack />, 'journal/[visitId]': VisitDetailScreen }, { initialUrl: '/journal/visit' });
  expect(screen.getByText('Privacy change pending')).toBeOnTheScreen();
  expect(screen.queryByText('Private visit')).toBeNull();
  expect(screen.getByText(/The published visit is still visible/)).toBeOnTheScreen();
});

it('syncs the entire published visit becoming Private before refreshing publication state', async () => {
  mockVisit.owner = 'account:test-account'; switchOwner(mockVisit.owner);
  mockPublication = { status: 'active', audience: 'public' };
  const save = jest.spyOn(visits, 'patchVisit').mockResolvedValue(undefined);
  await renderRouter({ _layout: () => <Stack />, 'journal/[visitId]': VisitDetailScreen }, { initialUrl: '/journal/visit' });
  await makePrivate();
  await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(1));
  expect(save).toHaveBeenCalledWith('visit', { visibility: 'private' }, mockVisit.owner);
  expect(mockFlush).toHaveBeenCalledTimes(1);
});

it('warns when a privacy change cannot sync and retries without toggling again', async () => {
  mockVisit.owner = 'account:test-account'; switchOwner(mockVisit.owner);
  const save = jest.spyOn(visits, 'patchVisit').mockResolvedValue(undefined);
  mockFlush.mockRejectedValueOnce(new Error('Offline'));
  await renderRouter({ _layout: () => <Stack />, 'journal/[visitId]': VisitDetailScreen }, { initialUrl: '/journal/visit' });
  await makePrivate();
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
  await makePrivate();
  expect(screen.getByRole('button', { name: 'Make private' })).toBeDisabled();
  await act(() => jest.advanceTimersByTime(30_000));
  expect(screen.getByRole('button', { name: 'Retry visibility' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Make private' })).toBeEnabled();
});


it('hides the bottom actions while editing and restores them after the keyboard closes', async () => {
  await renderRouter({ _layout: () => <Stack />, 'journal/[visitId]': VisitDetailScreen }, { initialUrl: '/journal/visit' });
  expect(screen.getByRole('button', { name: 'Prepare to share' })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Edit note' }));
  const keyboard = { duration: 250, easing: 'keyboard', endCoordinates: { screenX: 0, screenY: 500, width: 390, height: 300 } };
  await act(() => DeviceEventEmitter.emit('keyboardWillShow', keyboard));
  expect(screen.queryByRole('button', { name: 'Prepare to share' })).toBeNull();

  expect(screen.getByLabelText('Notes')).toBeOnTheScreen();
  expect(screen.queryByPlaceholderText('Search this visit')).toBeNull();
  await act(() => DeviceEventEmitter.emit('keyboardDidHide', keyboard));
  expect(screen.getByRole('button', { name: 'Prepare to share' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Make private' })).toBeOnTheScreen();
});

it('waits for pending notes to save before opening sharing', async () => {
  mockVisit.owner = 'account:test-account'; switchOwner(mockVisit.owner);
  let finish!: () => void;
  const save = jest.spyOn(visits, 'patchVisit').mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  const navigation = renderRouter({
    _layout: () => <Stack />,
    'journal/[visitId]': VisitDetailScreen,
    'visit-share/[visitId]/index': () => <Text>Publish preview</Text>,
  }, { initialUrl: '/journal/visit' });
  await navigation;
  await fireEvent.press(screen.getByRole('button', { name: 'Edit note' }));
  await fireEvent.changeText(screen.getByLabelText('Notes'), 'Remember the blue room');
  await fireEvent.press(screen.getByRole('button', { name: 'Prepare to share' }));
  expect(navigation.getPathname()).toBe('/journal/visit');
  await act(async () => finish());
  await waitFor(() => expect(navigation.getPathname()).toBe('/visit-share/visit'));
  expect(save).toHaveBeenCalledWith('visit', { reflection: 'Remember the blue room' }, mockVisit.owner, { sync: true });
});

it('keeps a pending Private sync distinct from a completed private save', async () => {
  mockVisit.owner = 'account:test-account'; mockVisit.visibility = 'private';
  mockPublication = { status: 'active', audience: 'public' };
  await renderRouter({ _layout: () => <Stack />, 'journal/[visitId]': VisitDetailScreen }, { initialUrl: '/journal/visit' });
  expect(screen.getByText('Privacy change waiting to sync')).toBeOnTheScreen();
  expect(screen.getByText('Waiting to sync. The published visit is still visible.')).toBeOnTheScreen();
  expect(screen.queryByText('Saved privately')).toBeNull();
  expect(screen.getByRole('button', { name: 'Save' })).toBeOnTheScreen();
});

async function openEndReview() {
  const navigation = renderRouter({
    _layout: () => <Stack />,
    index: () => <Pressable accessibilityRole="button" onPress={() => router.push('/journal/visit?endVisit=true')}><Text>End visit</Text></Pressable>,
    'journal/[visitId]': VisitDetailScreen,
    'visit-share/[visitId]/index': () => <Text>Publish preview</Text>,
    'sign-in': () => <Text>Share your museum visit.</Text>,
  });
  await navigation;
  await fireEvent.press(screen.getByRole('button', { name: 'End visit' }));
  return { navigation };
}

it('discards end-visit edits on Back and keeps the visit open', async () => {
  mockVisit.endedAt = null;
  const save = jest.spyOn(visits, 'patchVisit').mockResolvedValue(undefined);
  const { navigation } = await openEndReview();
  await fireEvent.changeText(screen.getByLabelText('Notes'), 'Not ready to finish');
  await fireEvent(screen.getByLabelText('Notes'), 'blur');
  await fireEvent.press(screen.getByRole('button', { name: 'Public visit. Make private.' }));
  expect(screen.getByRole('button', { name: 'Private visit. Make public.' })).toBeOnTheScreen();
  await act(() => router.back());
  expect(navigation.getPathname()).toBe('/');
  expect(mockEnd).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'End visit' }));
  expect(screen.getByLabelText('Notes')).toHaveProp('value', 'The afternoon light');
  expect(screen.getByRole('button', { name: 'Public visit. Make private.' })).toBeOnTheScreen();
});

it.each(['device:test-installation', 'account:test-account'])('saves and ends a private visit for %s without opening sharing', async (owner) => {
  mockVisit.owner = owner; switchOwner(owner); mockVisit.endedAt = null;
  const save = jest.spyOn(visits, 'patchVisit').mockResolvedValue(undefined);
  const { navigation } = await openEndReview();
  await fireEvent.changeText(screen.getByLabelText('Notes'), 'A private memory');
  await fireEvent.press(screen.getByRole('button', { name: 'Public visit. Make private.' }));
  expect(save).not.toHaveBeenCalled();
  expect(mockEnd).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(navigation.getPathname()).toBe('/'));
  expect(save).toHaveBeenCalledWith('visit', { reflection: 'A private memory' }, owner, { sync: true });
  expect(save).toHaveBeenCalledWith('visit', { visibility: 'private' }, owner);
  expect(mockEnd).toHaveBeenCalledWith('visit');
  expect(mockToast).toHaveBeenCalledWith('Visit saved.');
});

it('ends a public visit on Save before opening sharing', async () => {
  mockVisit.owner = 'account:test-account'; switchOwner(mockVisit.owner); mockVisit.endedAt = null;
  const { navigation } = await openEndReview();
  let finish!: () => void;
  mockEnd.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  expect(navigation.getPathname()).toBe('/journal/visit');
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  expect(mockEnd).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  await waitFor(() => expect(navigation.getPathname()).toBe('/visit-share/visit'));
  await act(() => router.back());
  expect(navigation.getSearchParams().endVisit).toBeUndefined();
});

it('keeps a failed end-visit save open and allows retry', async () => {
  mockVisit.endedAt = null; mockVisit.visibility = 'private';
  mockEnd.mockRejectedValueOnce(new Error('Storage unavailable'));
  const { navigation } = await openEndReview();
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t save visit. Try again.');
  expect(navigation.getPathname()).toBe('/journal/visit');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(navigation.getPathname()).toBe('/'));
  expect(mockEnd).toHaveBeenCalledTimes(2);
});

it('keeps the visit open when its note cannot save', async () => {
  mockVisit.endedAt = null;
  jest.spyOn(visits, 'patchVisit').mockRejectedValueOnce(new Error('Storage unavailable'));
  const { navigation } = await openEndReview();
  await fireEvent.changeText(screen.getByLabelText('Notes'), 'Keep this memory');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Your note could not be saved. Try again.');
  expect(mockEnd).not.toHaveBeenCalled();
  expect(navigation.getPathname()).toBe('/journal/visit');
  expect(screen.getByLabelText('Notes')).toHaveProp('value', 'Keep this memory');
});

it('offers Save for an already private visit and confirms it without sharing', async () => {
  mockVisit.visibility = 'private'; mockSharingBusy = true;
  const save = jest.spyOn(visits, 'patchVisit').mockResolvedValue(undefined);
  await renderRouter({ _layout: () => <Stack />, 'journal/[visitId]': VisitDetailScreen }, { initialUrl: '/journal/visit' });
  await fireEvent.press(screen.getByRole('button', { name: 'Edit note' }));
  await fireEvent.changeText(screen.getByLabelText('Notes'), 'Latest private note');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith('Visit saved.'));
  expect(save).toHaveBeenCalledWith('visit', { reflection: 'Latest private note' }, mockVisit.owner, { sync: true });
  expect(mockEnd).not.toHaveBeenCalled();
});
