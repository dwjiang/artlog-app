import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';
import type { VisitSummary } from '@/lib/journal/visit-summaries';
import { VisitDetailScreen } from './visit-detail-screen';

const mockVisit = {
  localId: 'visit', owner: 'device:test-installation', venueName: 'Museum',
  visitedOn: '2024-02-29', location: 'New York', reflection: 'The afternoon light', startedAt: 1, endedAt: 5,
  works: [{ localId: 'painting', title: 'Water Lilies', artist: 'Claude Monet', cropPath: null }],
} as VisitSummary;
let mockPublication: { status: string; audience: 'friends' | 'public' } | null = null;
jest.mock('@/lib/journal/use-visits', () => ({
  useVisits: () => ({ owner: mockVisit.owner, visits: [mockVisit], loading: false }),
}));
jest.mock('@/lib/visits/use-visit-sharing', () => ({
  useVisitSharing: () => ({ controller: {}, token: null, acknowledged: mockPublication }),
}));
jest.mock('../collection/saved-work-image', () => ({ SavedWorkImage: () => null }));
const mockMarkSeen = jest.fn();
jest.mock('@/lib/journal/visit-seen', () => ({ markVisitSeen: (...args: unknown[]) => mockMarkSeen(...args) }));

afterEach(() => jest.useRealTimers());
beforeEach(() => { mockPublication = null; mockVisit.owner = 'device:test-installation'; mockVisit.endedAt = 5; });

it('opens sign-in directly above a guest visit and preserves the visit when dismissed', async () => {
  const navigation = renderRouter({
    _layout: () => <Stack />,
    'journal/[visitId]': VisitDetailScreen,
    'sign-in': () => <Text>Share your museum visit.</Text>,
  }, { initialUrl: '/journal/visit' });
  await navigation;
  await fireEvent.press(screen.getByRole('button', { name: 'Share visit' }));
  await waitFor(() => expect(navigation.getPathname()).toBe('/sign-in'));
  expect(navigation.getSearchParams()).toMatchObject({ context: 'visit', visitId: 'visit' });
  await act(() => router.back());
  expect(navigation.getPathname()).toBe('/journal/visit');
  expect(screen.getByText('The afternoon light')).toBeOnTheScreen();
});

it.each(['friends', 'public'] as const)('shows the %s audience on a published visit', async (audience) => {
  mockVisit.owner = 'account:test-account';
  mockPublication = { status: 'active', audience };
  await renderRouter({ _layout: () => <Stack />, 'journal/[visitId]': VisitDetailScreen }, { initialUrl: '/journal/visit' });
  expect(screen.getByText(audience === 'public' ? 'Shared publicly' : 'Shared with friends')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Edit shared visit' })).toBeOnTheScreen();
});

it('opens saved artwork from a visit and returns to its private reflection', async () => {
  const navigation = renderRouter({
    _layout: () => <Stack />,
    'journal/[visitId]': VisitDetailScreen,
    'saved/[savedId]': () => <Text>Saved painting</Text>,
  }, { initialUrl: '/journal/visit' });
  await navigation;
  expect(screen.queryByText(/Private on this device/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Share visit' })).toBeOnTheScreen();
  expect(screen.getByText('The afternoon light')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('link', { name: 'Water Lilies, Claude Monet' }));
  await waitFor(() => expect(navigation.getPathname()).toBe('/saved/painting'));
  expect(screen.getByText('Saved painting')).toBeOnTheScreen();
  await act(() => router.back());
  expect(navigation.getPathname()).toBe('/journal/visit');
  expect(screen.getByText('The afternoon light')).toBeOnTheScreen();
});

it('searches a small visit from the artwork search control and restores the grid when closed', async () => {
  await renderRouter({ _layout: () => <Stack />, 'journal/[visitId]': VisitDetailScreen }, { initialUrl: '/journal/visit' });
  await fireEvent.press(screen.getByRole('button', { name: 'Search visit artworks' }));
  await fireEvent.changeText(screen.getByPlaceholderText('Search this visit'), 'unmatched');
  expect(screen.queryByRole('link', { name: 'Water Lilies, Claude Monet' })).toBeNull();
  expect(screen.getByText('No artworks match this search.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Hide artwork search' }));
  expect(screen.getByRole('link', { name: 'Water Lilies, Claude Monet' })).toBeOnTheScreen();
});

it('marks a closed visit as seen once it is opened, but not one still in progress', async () => {
  await renderRouter({ _layout: () => <Stack />, 'journal/[visitId]': VisitDetailScreen }, { initialUrl: '/journal/visit' });
  expect(mockMarkSeen).toHaveBeenCalledWith('visit', 'device:test-installation');
  mockMarkSeen.mockClear();
  mockVisit.endedAt = null;
  await renderRouter({ _layout: () => <Stack />, 'journal/[visitId]': VisitDetailScreen }, { initialUrl: '/journal/visit' });
  expect(mockMarkSeen).not.toHaveBeenCalled();
});
