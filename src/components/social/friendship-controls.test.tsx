import { fireEvent, render, screen } from '@testing-library/react-native';
import type { SocialSession } from '@/lib/social/use-social-session';
import { FriendshipControls } from './friendship-controls';

const mockPush = jest.fn(), mockAct = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));
jest.mock('@/lib/social/use-friendship', () => ({ useFriendship: () => ({ act: mockAct }) }));
const guest: SocialSession = { status: 'signed-out', key: 'guest', token: null, profileId: undefined,
  accountReady: false, offline: false, error: undefined, refresh: jest.fn() };

beforeEach(() => jest.clearAllMocks());

it('lets guests request sign-in from the friend action without sending a request', async () => {
  await render(<FriendshipControls profileId={'friend' as never} session={guest} />);
  expect(mockPush).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Add friend' }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/sign-in', params: { context: 'friends' } });
  expect(mockAct).not.toHaveBeenCalled();
});

it('continues to profile setup after sign-in without sending a request automatically', async () => {
  await render(<FriendshipControls profileId={'friend' as never} session={{ ...guest, status: 'profile-required' }} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Add friend' }));
  expect(mockPush).toHaveBeenCalledWith('/create-profile');
  expect(mockAct).not.toHaveBeenCalled();
});

it('keeps friendship actions unavailable while offline', async () => {
  await render(<FriendshipControls profileId={'friend' as never} session={{ ...guest, status: 'offline', offline: true }} />);
  expect(screen.queryByRole('button', { name: 'Add friend' })).toBeNull();
});
