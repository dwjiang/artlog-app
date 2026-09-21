import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { VenuePickerSheet } from './venue-picker-sheet';
import type { VenueView } from '@/lib/venue/use-venue';
import type { CurrentVisit, VenueOption } from '@/lib/venue/venue-reducer';
jest.mock('@/lib/venue/search-venues', () => ({ searchVenues: jest.fn() }));
jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }) }));

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockConfirm = jest.fn();
const mockDismiss = jest.fn();
const mockResolve = jest.fn();
const mockEnd = jest.fn();
let mockView: VenueView;
let mockParams: { mode?: string } = {};
let mockVisits: { localId: string; location: string; works: { localId: string; title: string; cropPath: null }[] }[] = [];

jest.mock('@/components/visits/visit-ui', () => ({ ArtworkPreviews: ({ works }: { works: unknown[] }) => { const { Text } = jest.requireActual('react-native'); return <Text>{works.length} previews</Text>; } }));
jest.mock('@/lib/journal/use-visits', () => ({ useVisits: () => ({ visits: mockVisits, loading: false }) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack, replace: mockReplace }), useLocalSearchParams: () => mockParams }));
jest.mock('@/lib/venue/use-venue', () => ({ useVenue: () => mockView }));

const seeded: VenueOption = { kind: 'seeded', venueId: 'id-met' as never, name: 'Metropolitan Museum of Art', distanceM: 42, website: 'https://www.metmuseum.org/' };
const neighbour: VenueOption = { kind: 'seeded', venueId: 'id-neue' as never, name: 'Neue Galerie', distanceM: 310 };
const poi: VenueOption = { kind: 'poi', name: 'Corner Gallery', lat: 1, lng: 2, distanceM: 1250, category: 'landmark' };
const visit: CurrentVisit = { localId: 'visit-1', venueId: 'id-met' as never, venueName: 'Metropolitan Museum of Art', startedAt: Date.UTC(2026, 8, 18, 21, 10), visitedOn: '2026-09-18', timeZone: 'America/New_York' };

beforeEach(() => {
  jest.resetAllMocks();
  mockConfirm.mockResolvedValue(undefined);
  mockEnd.mockResolvedValue(undefined);
  mockParams = {};
  mockVisits = [];
  mockView = { status: 'choose', options: [seeded, neighbour], resolve: mockResolve, confirm: mockConfirm, dismiss: mockDismiss, end: mockEnd };
});

describe('choosing a museum', () => {
  it('lists nearby museums and confirms the tapped museum', async () => {
    await render(<VenuePickerSheet />);
    expect(screen.getByRole('header', { name: 'Choose museum' })).toBeOnTheScreen();
    expect(screen.getByText('40 m · nearest')).toBeOnTheScreen();
    expect(screen.getByText('310 m')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: seeded.name }));
    expect(mockConfirm).toHaveBeenCalledWith(seeded, expect.any(AbortSignal));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('confirms another candidate after it is tapped', async () => {
    await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole('button', { name: 'Neue Galerie' }));
        expect(mockConfirm).toHaveBeenCalledWith(neighbour, expect.any(AbortSignal));
  });

  it('keeps the no-museum exit available while searching and when nothing matches', async () => {
    const { searchVenues } = jest.requireMock('@/lib/venue/search-venues');
    searchVenues.mockResolvedValue([]);
    await render(<VenuePickerSheet />);
    await fireEvent.changeText(screen.getByLabelText('Search museums'), 'Missing museum');
    expect(screen.getByRole('button', { name: 'Continue without a museum' })).toBeOnTheScreen();
    expect(await screen.findByText('No museums found.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Continue without a museum' }));
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockDismiss).toHaveBeenCalledTimes(1);
  });

  it('confirms a searched museum by hand for the museum’s current day', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 8, 19, 2, 30));
    const { searchVenues } = jest.requireMock('@/lib/venue/search-venues');
    searchVenues.mockResolvedValue([{ id: 'id-met', key: 'wikidata:Q160236', name: 'Metropolitan Museum of Art', lat: 40.7794, lng: -73.9633, website: null, region: 'new-york', city: 'New York', cityKey: 'new-york', country: 'US' }]);
    await render(<VenuePickerSheet />);
    await fireEvent.changeText(screen.getByLabelText('Search museums'), 'Metropolitan');
    await fireEvent.press(await screen.findByRole('button', { name: 'Metropolitan Museum of Art' }));
    expect(mockConfirm).toHaveBeenCalledWith({ kind: 'seeded', venueId: 'id-met', name: 'Metropolitan Museum of Art',
      manual: { timeZone: 'America/New_York', visitedOn: '2026-09-18' } }, expect.any(AbortSignal));
  });

  it('confirms a lone museum directly without a redundant selection step', async () => {
    mockView = { ...mockView, options: [{ ...seeded, distanceM: 300 }] };
    await render(<VenuePickerSheet />);
    expect(screen.getByRole('header', { name: 'Choose museum' })).toBeOnTheScreen();
    expect(screen.getAllByText(seeded.name)).toHaveLength(1);
    expect(screen.getByRole('button', { name: seeded.name })).toBeOnTheScreen();
    expect(screen.getByText('300 m · nearest')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: seeded.name }));
    expect(mockConfirm).toHaveBeenCalledWith(mockView.options[0], expect.any(AbortSignal));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('allows retrying a failed single-place confirmation', async () => {
    mockView = { ...mockView, options: [seeded] };
    mockConfirm.mockRejectedValueOnce(new Error('Could not confirm the venue. Try again.'));
    await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole('button', { name: seeded.name }));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not confirm the venue. Try again.');
    expect(mockBack).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: seeded.name }));
    expect(mockConfirm).toHaveBeenCalledTimes(2);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('can cancel a pending single-place confirmation without ending a paused visit', async () => {
    mockParams = { mode: 'choose' };
    mockView = { ...mockView, visit, options: [seeded] };
    let finish!: () => void;
    mockConfirm.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    await render(<VenuePickerSheet />);
    const confirm = screen.getByRole('button', { name: seeded.name });
    await fireEvent.press(confirm);
    expect(confirm).toBeBusy();
    expect(confirm).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Continue without a museum' }));
    expect(mockConfirm.mock.calls[0][1].aborted).toBe(true);
    expect(mockDismiss).toHaveBeenCalledTimes(1);
    expect(mockEnd).not.toHaveBeenCalled();
    await act(async () => { finish(); });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('shows a place category for MapKit results and never calls them museums', async () => {
    mockView = { ...mockView, status: 'none', options: [poi] };
    const view = await render(<VenuePickerSheet />);
    expect(screen.getByRole('header', { name: 'Choose museum' })).toBeOnTheScreen();
    expect(screen.getByText('1.3 km · landmark · nearest')).toBeOnTheScreen();
    mockView = { ...mockView, options: [poi, { ...poi, name: 'Side Street Studio', distanceM: 1400 }] };
    await view.rerender(<VenuePickerSheet />);
    expect(screen.getByRole('header', { name: 'Choose museum' })).toBeOnTheScreen();
    expect(screen.getByText('1.3 km · landmark · nearest')).toBeOnTheScreen();
  });

  it('keeps the sheet open with the reason when confirmation fails', async () => {
    mockConfirm.mockRejectedValue(new Error('rate_limited'));
    await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole('button', { name: seeded.name }));
    expect(screen.getByText('rate_limited')).toBeOnTheScreen();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('dismisses with "Not here" without confirming anything', async () => {
    await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole('button', { name: 'Continue without a museum' }));
    expect(mockDismiss).toHaveBeenCalledTimes(1);
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('explains an empty result and a denied permission with a way to Settings', async () => {
    mockView = { ...mockView, status: 'none', options: [] };
    const view = await render(<VenuePickerSheet />);
    expect(screen.getByText('Art turns up everywhere.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Continue without a museum' })).toBeOnTheScreen();
    mockView = { ...mockView, status: 'denied', options: [] };
    await view.rerender(<VenuePickerSheet />);
    expect(screen.getByText('Find your museum, wherever you are.')).toBeOnTheScreen();
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    await fireEvent.press(screen.getByRole('button', { name: 'Open Settings' }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('allows continuing without a museum while locating', async () => {
    mockView = { ...mockView, status: 'locating', options: [] };
    await render(<VenuePickerSheet />);
    expect(screen.getByRole('progressbar', { name: 'Locating your museum' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Continue without a museum' })).toBeOnTheScreen();
    expect(screen.queryByText('Finding your museum…')).toBeNull();
  });

  it('marks the confirming row busy without swapping its detail for text', async () => {
    mockConfirm.mockReturnValue(new Promise<void>(() => {}));
    await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole('button', { name: 'Metropolitan Museum of Art' }));
    expect(screen.getByRole('button', { name: 'Metropolitan Museum of Art' })).toBeBusy();
    expect(screen.queryByText('Confirming…')).toBeNull();
  });

  it.each(['Not here', 'swipe'])('cancels a pending confirmation on %s without navigating again', async (method) => {
    let finish!: () => void;
    mockConfirm.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const view = await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole('button', { name: seeded.name }));
    if (method === 'Not here') await fireEvent.press(screen.getByRole('button', { name: 'Continue without a museum' }));
    await view.unmount();
    const [, signal] = mockConfirm.mock.calls[0];
    expect(signal.aborted).toBe(true);
    await act(async () => { finish(); });
    expect(mockBack).toHaveBeenCalledTimes(method === 'Not here' ? 1 : 0);
  });
});

describe('the open visit', () => {
  beforeEach(() => {
    mockView = { ...mockView, status: 'resolved', venue: seeded, visit, options: [seeded, neighbour] };
    mockVisits = [{ localId: 'visit-1', location: 'New York, United States', works: [{ localId: 'w1', title: 'Water Lilies', cropPath: null }, { localId: 'w2', title: 'Irises', cropPath: null }] }];
  });

  it('shows the visit with its start time, place and artworks instead of the chooser', async () => {
    await render(<VenuePickerSheet />);
    expect(screen.getByText('Visiting now · since 5:10 PM')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Metropolitan Museum of Art' })).toBeOnTheScreen();
    expect(screen.getByText('New York, United States · 2 artworks this visit')).toBeOnTheScreen();
    expect(screen.getByText('2 previews')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Continue without a museum' })).toBeNull();
  });

  it('opens the end-visit review without ending the visit', async () => {
    await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole('button', { name: 'End visit' }));
    expect(mockEnd).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/journal/[visitId]', params: { visitId: 'visit-1', endVisit: 'true' } });
  });

  it('opens the visit detail in place of the sheet', async () => {
    await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole('button', { name: 'Open visit' }));
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/journal/[visitId]', params: { visitId: 'visit-1' } });
    expect(mockEnd).not.toHaveBeenCalled();
  });

  it('switches to the chooser on "Change museum" and back with "Keep current visit"', async () => {
    await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole('button', { name: 'Change museum' }));
    expect(screen.getByRole('header', { name: 'Choose museum' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Continue without a museum' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Keep current visit' }));
    expect(screen.getByRole('button', { name: 'End visit' })).toBeOnTheScreen();
    expect(mockDismiss).not.toHaveBeenCalled();
  });

  it('confirms a different museum from the chooser', async () => {
    await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole('button', { name: 'Change museum' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Neue Galerie' }));
        expect(mockConfirm).toHaveBeenCalledWith(neighbour, expect.any(AbortSignal));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('shows the chooser for a paused visit when location is denied', async () => {
    mockView = { ...mockView, status: 'denied', venue: undefined, options: [] };
    await render(<VenuePickerSheet />);
    expect(screen.getByText('Find your museum, wherever you are.')).toBeOnTheScreen();
  });

  it('offers the resolved museum, not the visit paused at another one, when the pill opens the sheet', async () => {
    mockView = { ...mockView, venue: neighbour, options: [neighbour] };
    await render(<VenuePickerSheet />);
    expect(screen.getByRole('header', { name: 'Choose museum' })).toBeOnTheScreen();
    expect(screen.getByText('Neue Galerie')).toBeOnTheScreen();
    expect(screen.queryByText(/Visiting now/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'End visit' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Continue without a museum' }));
    expect(mockDismiss).toHaveBeenCalledTimes(1);
    expect(mockEnd).not.toHaveBeenCalled();
  });

  it('lists the candidates for a prompt while the visit is paused elsewhere, and "Not here" dismisses without ending it', async () => {
    mockParams = { mode: 'choose' };
    mockView = { ...mockView, status: 'choose', venue: undefined, options: [{ ...seeded, venueId: 'id-guggenheim' as never, name: 'Guggenheim', distanceM: 120 }, neighbour] };
    await render(<VenuePickerSheet />);
    expect(screen.getByRole('header', { name: 'Choose museum' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Keep current visit' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Continue without a museum' }));
    expect(mockDismiss).toHaveBeenCalledTimes(1);
    expect(mockEnd).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
