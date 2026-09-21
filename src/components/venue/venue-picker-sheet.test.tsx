import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking, StyleSheet } from 'react-native';

import { VenuePickerSheet } from './venue-picker-sheet';
import type { VenueView } from '@/lib/venue/use-venue';
import type { CurrentVisit, VenueOption } from '@/lib/venue/venue-reducer';
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

jest.mock('@/components/collection/gallery-button');
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
  it('pre-selects the nearest candidate and confirms it with one tap', async () => {
    await render(<VenuePickerSheet />);
    expect(screen.getByRole('header', { name: '2 museums nearby' })).toBeOnTheScreen();
    expect(screen.getByText('40 m · nearest')).toBeOnTheScreen();
    expect(screen.getByText('310 m')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Metropolitan Museum of Art' })).toBeSelected();
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm Metropolitan Museum of Art' }));
    expect(mockConfirm).toHaveBeenCalledWith(seeded, expect.any(AbortSignal));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('confirms another candidate after it is tapped', async () => {
    await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole('button', { name: 'Neue Galerie' }));
    expect(screen.getByRole('button', { name: 'Neue Galerie' })).toBeSelected();
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm Neue Galerie' }));
    expect(mockConfirm).toHaveBeenCalledWith(neighbour, expect.any(AbortSignal));
  });

  it('gives the selected museum a uniform border when selection changes', async () => {
    await render(<VenuePickerSheet />);
    const nearest = screen.getByRole('button', { name: seeded.name });
    const other = screen.getByRole('button', { name: neighbour.name });
    expect(nearest).toHaveStyle({ borderWidth: 1 });
    expect(nearest).not.toHaveStyle({ borderBottomWidth: StyleSheet.hairlineWidth });
    expect(other).toHaveStyle({ borderBottomWidth: StyleSheet.hairlineWidth });

    await fireEvent.press(other);

    expect(other).toHaveStyle({ borderWidth: 1 });
    expect(other).not.toHaveStyle({ borderBottomWidth: StyleSheet.hairlineWidth });
    expect(nearest).toHaveStyle({ borderBottomWidth: StyleSheet.hairlineWidth });
  });

  it('confirms a lone museum directly without a redundant selection step', async () => {
    mockView = { ...mockView, options: [{ ...seeded, distanceM: 300 }] };
    await render(<VenuePickerSheet />);
    expect(screen.getByRole('header', { name: 'Visiting here?' })).toBeOnTheScreen();
    expect(screen.getAllByText(seeded.name)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: seeded.name })).toBeNull();
    expect(screen.getByText('300 m')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Yes, I’m here' }));
    expect(mockConfirm).toHaveBeenCalledWith(mockView.options[0], expect.any(AbortSignal));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('allows retrying a failed single-place confirmation', async () => {
    mockView = { ...mockView, options: [seeded] };
    mockConfirm.mockRejectedValueOnce(new Error('Could not confirm the venue. Try again.'));
    await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole('button', { name: 'Yes, I’m here' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not confirm the venue. Try again.');
    expect(mockBack).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Yes, I’m here' }));
    expect(mockConfirm).toHaveBeenCalledTimes(2);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('can cancel a pending single-place confirmation without ending a paused visit', async () => {
    mockParams = { mode: 'choose' };
    mockView = { ...mockView, visit, options: [seeded] };
    let finish!: () => void;
    mockConfirm.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    await render(<VenuePickerSheet />);
    const confirm = screen.getByRole('button', { name: 'Yes, I’m here' });
    await fireEvent.press(confirm);
    expect(confirm).toBeBusy();
    expect(confirm).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Not here' }));
    expect(mockConfirm.mock.calls[0][1].aborted).toBe(true);
    expect(mockDismiss).toHaveBeenCalledTimes(1);
    expect(mockEnd).not.toHaveBeenCalled();
    await act(async () => { finish(); });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('shows a place category for MapKit results and never calls them museums', async () => {
    mockView = { ...mockView, status: 'none', options: [poi] };
    const view = await render(<VenuePickerSheet />);
    expect(screen.getByRole('header', { name: 'Visiting here?' })).toBeOnTheScreen();
    expect(screen.getByText('1.3 km · landmark')).toBeOnTheScreen();
    mockView = { ...mockView, options: [poi, { ...poi, name: 'Side Street Studio', distanceM: 1400 }] };
    await view.rerender(<VenuePickerSheet />);
    expect(screen.getByRole('header', { name: 'Looks like you’re at…' })).toBeOnTheScreen();
    expect(screen.getByText('1.3 km · landmark · nearest')).toBeOnTheScreen();
  });

  it('keeps the sheet open with the reason when confirmation fails', async () => {
    mockConfirm.mockRejectedValue(new Error('rate_limited'));
    await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm Metropolitan Museum of Art' }));
    expect(screen.getByText('rate_limited')).toBeOnTheScreen();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('dismisses with "Not here" without confirming anything', async () => {
    await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole('button', { name: 'Not here' }));
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
    expect(screen.getByText('A place for this moment.')).toBeOnTheScreen();
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    await fireEvent.press(screen.getByRole('button', { name: 'Open Settings' }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('shows progress while locating without a dismiss button', async () => {
    mockView = { ...mockView, status: 'locating', options: [] };
    await render(<VenuePickerSheet />);
    expect(screen.getByText('Finding your museum…')).toHaveStyle({ textAlign: 'center' });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each(['Not here', 'swipe'])('cancels a pending confirmation on %s without navigating again', async (method) => {
    let finish!: () => void;
    mockConfirm.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const view = await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm Metropolitan Museum of Art' }));
    if (method === 'Not here') await fireEvent.press(screen.getByRole('button', { name: 'Not here' }));
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
    expect(screen.queryByRole('button', { name: 'Not here' })).toBeNull();
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
    expect(screen.getByRole('header', { name: '2 museums nearby' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Not here' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Keep current visit' }));
    expect(screen.getByRole('button', { name: 'End visit' })).toBeOnTheScreen();
    expect(mockDismiss).not.toHaveBeenCalled();
  });

  it('confirms a different museum from the chooser', async () => {
    await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole('button', { name: 'Change museum' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Neue Galerie' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm Neue Galerie' }));
    expect(mockConfirm).toHaveBeenCalledWith(neighbour, expect.any(AbortSignal));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('shows the chooser for a paused visit when location is denied', async () => {
    mockView = { ...mockView, status: 'denied', venue: undefined, options: [] };
    await render(<VenuePickerSheet />);
    expect(screen.getByText('A place for this moment.')).toBeOnTheScreen();
  });

  it('lists the candidates for a prompt while the visit is paused elsewhere, and "Not here" dismisses without ending it', async () => {
    mockParams = { mode: 'choose' };
    mockView = { ...mockView, status: 'choose', venue: undefined, options: [{ ...seeded, venueId: 'id-guggenheim' as never, name: 'Guggenheim', distanceM: 120 }, neighbour] };
    await render(<VenuePickerSheet />);
    expect(screen.getByRole('header', { name: '2 museums nearby' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Keep current visit' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Not here' }));
    expect(mockDismiss).toHaveBeenCalledTimes(1);
    expect(mockEnd).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
