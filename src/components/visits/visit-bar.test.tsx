import { act, fireEvent, render, screen } from '@testing-library/react-native';

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

it('ends the visit from the bar and opens its detail', async () => {
  let finish!: () => void;
  mockEnd.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
  await render(<VisitBar />);
  await fireEvent.press(screen.getByRole('button', { name: 'End visit' }));
  expect(screen.getByRole('button', { name: 'End visit' })).toBeBusy();
  await act(async () => { finish(); });
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/journal/[visitId]', params: { visitId: 'visit-1' } });
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

it('keeps the visit available and offers another attempt if ending fails', async () => {
  mockEnd.mockRejectedValueOnce(new Error('Could not save'));
  await render(<VisitBar />);
  await fireEvent.press(screen.getByRole('button', { name: 'End visit' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t end visit. Try again.');
  expect(mockPush).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'End visit' }));
  expect(mockEnd).toHaveBeenCalledTimes(2);
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/journal/[visitId]', params: { visitId: 'visit-1' } });
});
