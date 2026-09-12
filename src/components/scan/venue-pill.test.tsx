import { fireEvent, render, screen } from '@testing-library/react-native';

import { VenuePill } from './venue-pill';
import type { VenueView } from '@/lib/venue/use-venue';

const mockPush = jest.fn();
let mockView: VenueView;

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/lib/venue/use-venue', () => ({ useVenue: () => mockView }));

const legion = { kind: 'seeded', venueId: 'id-legion' as never, name: 'Legion of Honor', distanceM: 40 } as const;

function view(status: VenueView['status'], venue?: VenueView['venue']): VenueView {
  return { status, venue, options: [], resolve: jest.fn(), confirm: jest.fn(), dismiss: jest.fn() };
}

beforeEach(() => mockPush.mockReset());

it('names the museum the phone resolved and opens the picker on tap', async () => {
  mockView = view('resolved', legion);
  await render(<VenuePill />);
  await fireEvent.press(screen.getByRole('button', { name: 'Legion of Honor' }));
  expect(mockPush).toHaveBeenCalledWith('/venue-picker');
});

it('says it is still looking while the first fix is in flight and cannot be tapped', async () => {
  mockView = view('locating');
  await render(<VenuePill />);
  const pill = screen.getByRole('button', { name: 'Finding your museum…' });
  expect(pill).toBeDisabled();
  expect(pill).toBeBusy();
  await fireEvent.press(pill);
  expect(mockPush).not.toHaveBeenCalled();
});

it('keeps the visit venue while a fresh fix is in flight', async () => {
  mockView = view('locating', legion);
  await render(<VenuePill />);
  expect(screen.getByRole('button', { name: 'Legion of Honor' })).toBeEnabled();
});

it.each([
  ['none', 'No museum nearby'],
  ['denied', 'Location is off'],
  ['choose', 'Which museum?'],
] as [VenueView['status'], string][])('offers the picker when the status is %s', async (status, label) => {
  mockView = view(status);
  await render(<VenuePill />);
  await fireEvent.press(screen.getByRole('button', { name: label }));
  expect(mockPush).toHaveBeenCalledWith('/venue-picker');
});
