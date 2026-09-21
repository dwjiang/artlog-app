import { fireEvent, render, screen } from '@testing-library/react-native';

import { VisitBar } from './visit-bar';
import type { VenueView } from '@/lib/venue/use-venue';

const mockPush = jest.fn();
let mockLoading = false;
const mockEnd = jest.fn();
let mockVisit: VenueView['visit'];
let mockWorks: { localId: string; title: string; cropPath: string | null }[] = [];

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/lib/venue/use-venue', () => ({ useVenue: () => ({ visit: mockVisit, end: mockEnd }) }));
jest.mock('@/lib/account/owner-store', () => ({ useLocalOwner: () => 'device:test' }));
jest.mock('@/lib/account/photo-sync', () => ({ cropSyncing: () => false }));
jest.mock('@/lib/journal/use-visit-works', () => ({ useVisitWorks: (visitLocalId?: string) => ({ works: visitLocalId ? mockWorks : [], loading: mockLoading }) }));
jest.mock('../collection/saved-work-image', () => ({ SavedWorkImage: ({ title }: { title: string }) => { const { Text } = jest.requireActual('react-native'); return <Text>{title} cover</Text>; } }));

beforeEach(() => {
  jest.clearAllMocks(); mockLoading = false;
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

it('renders nothing without an open visit', async () => {
  mockVisit = undefined;
  await render(<VisitBar />);
  expect(screen.queryByRole('button')).toBeNull();
});

it('does not report zero artworks before the initial read completes', async () => {
  mockWorks = []; mockLoading = true;
  const view = await render(<VisitBar />);
  expect(screen.getByLabelText('Loading visit artwork count')).toBeOnTheScreen();
  expect(screen.queryByText(/0 artworks/)).toBeNull();
  mockLoading = false;
  await view.rerender(<VisitBar />);
  expect(screen.getByText('Visiting now · 0 artworks saved')).toBeOnTheScreen();
});
