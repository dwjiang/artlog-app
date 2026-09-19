import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { VenuePickerSheet } from './venue-picker-sheet';
import type { VenueView } from '@/lib/venue/use-venue';
import type { VenueOption } from '@/lib/venue/venue-reducer';
jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));

const mockBack = jest.fn();
const mockConfirm = jest.fn();
const mockDismiss = jest.fn();
const mockResolve = jest.fn();
let mockView: VenueView;

jest.mock('@/components/collection/gallery-button');
jest.mock('@expo/ui', () => {
  const { Pressable, Text, View } = jest.requireActual('react-native');
  return {
    Host: View,
    Button: ({ label, onPress }: { label: string; onPress: () => void }) => (
      <Pressable accessibilityRole="button" onPress={onPress}><Text>{label}</Text></Pressable>
    ),
  };
});
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }));
jest.mock('@/lib/venue/use-venue', () => ({ useVenue: () => mockView }));

const seeded: VenueOption = { kind: 'seeded', venueId: 'id-met' as never, name: 'Metropolitan Museum of Art', distanceM: 42, website: 'https://www.metmuseum.org/' };
const neighbour: VenueOption = { kind: 'seeded', venueId: 'id-neue' as never, name: 'Neue Galerie', distanceM: 310 };
const poi: VenueOption = { kind: 'poi', name: 'Corner Gallery', lat: 1, lng: 2, distanceM: 1250, category: 'landmark' };

beforeEach(() => {
  jest.resetAllMocks();
  mockConfirm.mockResolvedValue(undefined);
  mockView = { status: 'choose', options: [seeded, neighbour], resolve: mockResolve, confirm: mockConfirm, dismiss: mockDismiss };
});

it('lists the candidates with distances and confirms the tapped one before closing', async () => {
  await render(<VenuePickerSheet />);
  expect(screen.getByText('Looks like you’re at…')).toBeOnTheScreen();
  expect(screen.getByText('40 m')).toBeOnTheScreen();
  expect(screen.getByText('310 m')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Neue Galerie' }));
  expect(mockConfirm).toHaveBeenCalledWith(neighbour, expect.any(AbortSignal));
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it('marks the current venue and shows a place category', async () => {
  mockView = { ...mockView, status: 'resolved', venue: seeded, options: [seeded, poi] };
  await render(<VenuePickerSheet />);
  expect(screen.getByText('40 m · current')).toBeOnTheScreen();
  expect(screen.getByText('1.3 km · landmark')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Metropolitan Museum of Art' })).toBeSelected();
});

it('keeps the sheet open with the reason when confirmation fails', async () => {
  mockConfirm.mockRejectedValue(new Error('rate_limited'));
  await render(<VenuePickerSheet />);
  await fireEvent.press(screen.getByRole('button', { name: 'Neue Galerie' }));
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
  expect(screen.getByText('No museum nearby')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'OK' })).toBeOnTheScreen();
  mockView = { ...mockView, status: 'denied', options: [] };
  await view.rerender(<VenuePickerSheet />);
  expect(screen.getByText('Location is off')).toBeOnTheScreen();
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
  await fireEvent.press(screen.getByRole('button', { name: 'Neue Galerie' }));
  if (method === 'Not here') await fireEvent.press(screen.getByRole('button', { name: 'Not here' }));
  await view.unmount();
  const [, signal] = mockConfirm.mock.calls[0];
  expect(signal.aborted).toBe(true);
  await act(async () => { finish(); });
  expect(mockBack).toHaveBeenCalledTimes(method === 'Not here' ? 1 : 0);
});
