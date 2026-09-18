import { fireEvent, render, screen } from '@testing-library/react-native';
import { ShareProfileScreen } from './share-profile-screen';

const mockBack = jest.fn(), mockRefresh = jest.fn();
let mockResult: { data: unknown; loading: boolean; error?: Error };
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }), useLocalSearchParams: () => ({ profileId: 'public-profile' }) }));
jest.mock('@/lib/social/use-social-session', () => ({ useSocialSession: () => ({ key: 'guest', status: 'signed-out' }) }));
jest.mock('@/lib/social/use-social-query', () => ({ useSocialQuery: () => ({ ...mockResult, refresh: mockRefresh }) }));

beforeEach(() => { jest.clearAllMocks(); mockResult = { data: undefined, loading: true }; });

it('distinguishes loading from a completed unavailable profile and provides a way out', async () => {
  const view = await render(<ShareProfileScreen />);
  expect(screen.getByText('Opening your profile…')).toBeOnTheScreen();
  expect(screen.queryByText('Profile unavailable.')).toBeNull();
  mockResult = { data: null, loading: false };
  await view.rerender(<ShareProfileScreen />);
  expect(screen.getByText('Profile unavailable.')).toBeOnTheScreen();
  expect(screen.queryByText('Opening your profile…')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it('retries an unsuccessful profile query without calling it unavailable', async () => {
  mockResult = { data: undefined, loading: false, error: new Error('Offline') };
  await render(<ShareProfileScreen />);
  expect(screen.getByText('Couldn’t load your profile.')).toBeOnTheScreen();
  expect(screen.queryByText('Profile unavailable.')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});
