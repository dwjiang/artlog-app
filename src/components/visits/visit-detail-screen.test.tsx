import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';
import type { VisitSummary } from '@/lib/journal/visit-summaries';
import { VisitDetailScreen } from './visit-detail-screen';

const mockVisit = {
  localId: 'visit', owner: 'device:test-installation', venueName: 'Museum',
  visitedOn: '2024-02-29', location: 'New York', reflection: 'The afternoon light',
  works: [{ localId: 'painting', title: 'Water Lilies', artist: 'Claude Monet', cropPath: null }],
} as VisitSummary;
jest.mock('@/lib/journal/use-visits', () => ({
  useVisits: () => ({ owner: mockVisit.owner, visits: [mockVisit], loading: false }),
}));
jest.mock('@/lib/visits/use-visit-sharing', () => ({
  useVisitSharing: () => ({ controller: {}, token: null, acknowledged: null }),
}));
jest.mock('../collection/saved-work-image', () => ({ SavedWorkImage: () => null }));

afterEach(() => jest.useRealTimers());

it('opens saved artwork from a visit and returns to its private reflection', async () => {
  const navigation = renderRouter({
    _layout: () => <Stack />,
    'visit/[visitId]': VisitDetailScreen,
    '[savedId]': () => <Text>Saved painting</Text>,
  }, { initialUrl: '/visit/visit' });
  await navigation;
  expect(screen.getByText('The afternoon light')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('link', { name: 'Water Lilies, Claude Monet' }));
  await waitFor(() => expect(navigation.getPathname()).toBe('/painting'));
  expect(screen.getByText('Saved painting')).toBeOnTheScreen();
  await act(() => router.back());
  expect(navigation.getPathname()).toBe('/visit/visit');
  expect(screen.getByText('The afternoon light')).toBeOnTheScreen();
});
