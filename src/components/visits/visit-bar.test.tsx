import { fireEvent, render, screen } from '@testing-library/react-native';

import { VisitBar } from './visit-bar';
import type { VenueView } from '@/lib/venue/use-venue';

const mockPush = jest.fn();
const mockEnd = jest.fn();
let mockVisit: VenueView['visit'];
let mockWorks: { localId: string; title: string; cropPath: string | null }[] = [];

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/lib/venue/use-venue', () => ({ useVenue: () => ({ visit: mockVisit, end: mockEnd }) }));
jest.mock('@/lib/account/owner-store', () => ({ useLocalOwner: () => 'device:test' }));
jest.mock('@/lib/account/photo-sync', () => ({ cropSyncing: () => false }));
jest.mock('@/lib/journal/use-visit-works', () => ({ useVisitWorks: (visitLocalId?: string) => visitLocalId ? mockWorks : [] }));
jest.mock('../collection/saved-work-image', () => ({ SavedWorkImage: ({ title }: { title: string }) => { const { Text } = jest.requireActual('react-native'); return <Text>{title} cover</Text>; } }));

beforeEach(() => {
  jest.clearAllMocks();
  mockEnd.mockResolvedValue(undefined);
  mockVisit = { localId: 'visit-1', venueId: 'id-legion' as never, venueName: 'Legion of Honor', startedAt: 1, visitedOn: '2026-09-18', timeZone: 'America/Los_Angeles' };
  mockWorks = [{ localId: 'a', title: 'Water Lilies', cropPath: 'a.jpg' }, { localId: 'b', title: 'Irises', cropPath: null }];
});

it('names the open visit with its artwork count and opens its detail', async () => {
  await render(<VisitBar />);
  expect(screen.getByText('Visiting now · 2 artworks saved')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Visiting Legion of Honor, 2 artworks' }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/journal/[visitId]', params: { visitId: 'visit-1' } });
});

it('opens the end-visit review without ending the visit', async () => {
  await render(<VisitBar />);
  await fireEvent.press(screen.getByRole('button', { name: 'End visit' }));
  expect(mockEnd).not.toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/journal/[visitId]', params: { visitId: 'visit-1', endVisit: 'true' } });
});

it('shows only the name when placed inline next to a minimized tab bar', async () => {
  await render(<VisitBar compact />);
  expect(screen.getByText('Legion of Honor')).toBeOnTheScreen();
  expect(screen.queryByText(/Visiting now/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'End visit' })).toBeNull();
});

it('renders nothing without an open visit', async () => {
  mockVisit = undefined;
  await render(<VisitBar />);
  expect(screen.queryByRole('button')).toBeNull();
});
