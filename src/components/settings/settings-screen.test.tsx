import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { SettingsDetailScreen } from './settings-detail-screen';
import { SettingsScreen } from './settings-screen';
import { PRIVACY_COPY } from './privacy-section';
import { setSetting } from '@/db/repos/settings';

const mockPush = jest.fn();
const mockWithdraw = jest.fn();
const mockSignOut = jest.fn();
const mockSignIn = jest.fn();
const mockDelete = jest.fn();
let mockAccount: { linked: boolean; deviceCount: number; email?: string } | null = null;
let mockReady = true;
let mockBusy = false;
let mockSessionStatus = 'ready';
const contribution = {
  contributionId: 'contribution-1', status: 'tentative', fields: { title: { value: 'Water Lilies' }, artist: { value: 'Claude Monet' } },
};

jest.mock('./leaderboard-preference', () => ({ LeaderboardPreference: () => null }));
jest.mock('@/lib/social/use-social-session', () => ({ useSocialSession: () => ({ status: mockSessionStatus, key: 'settings' }) }));
jest.mock('@/lib/social/use-social-query', () => ({ useSocialQuery: () => ({ data: mockAccount?.linked ? { name: 'Alex', username: 'alex' } : undefined }) }));
jest.mock('@expo/ui');
jest.mock('@expo/ui/swift-ui');
jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
jest.mock('@/hooks/use-screen-active', () => ({ useScreenActive: () => true }));
jest.mock('@/lib/use-device-ready', () => ({ useDeviceReady: () => mockReady }));
jest.mock('./dev-tools', () => ({ DevTools: () => null }));
jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationButtonType: { SIGN_IN: 0 }, AppleAuthenticationButtonStyle: { BLACK: 0 },
  AppleAuthenticationButton: ({ onPress }: { onPress: () => void }) => {
    const { Pressable, Text } = jest.requireActual('react-native');
    return <Pressable accessibilityRole="button" onPress={onPress}><Text>Sign in with Apple</Text></Pressable>;
  },
}));
jest.mock('@/lib/account/use-account', () => ({
  useAccount: () => ({ account: mockAccount, available: true, busy: mockBusy, ready: true, signOut: mockSignOut, signInWithApple: mockSignIn, deleteAccount: mockDelete }),
}));
jest.mock('convex/react', () => ({
  useConvexAuth: () => ({ isAuthenticated: true }),
  useMutation: () => mockWithdraw,
  useQuery: (fn: unknown, args: unknown) => {
    if (args === 'skip') return undefined;
    const name = jest.requireActual('convex/server').getFunctionName(fn);
    if (name === 'health:ping') return { modelVersion: 'test' };
    if (name === 'contributions:mine') return [contribution];
    return undefined;
  },
}));
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) }, Stack: { Screen: () => null }, Link: ({ children }: { children: ReactNode }) => children }));

beforeEach(async () => {
  jest.clearAllMocks(); mockAccount = null; mockReady = true; mockBusy = false; mockSessionStatus = 'ready';
  mockWithdraw.mockResolvedValue(null);
});

it('shows grouped settings and opens the matching detail', async () => {
  await render(<SettingsScreen />);
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeOnTheScreen();
  expect(screen.queryByText('YA', { includeHiddenElements: true })).toBeNull();
  for (const title of ['Settings', 'Your journal', 'Artlog', 'Developer']) expect(screen.getByRole('header', { name: title })).toBeOnTheScreen();
  for (const [label, section] of [['Visits', 'visits'], ['Privacy', 'privacy'], ['Export journal', 'export'], ['About', 'about']]) {
    await fireEvent.press(screen.getByRole('button', { name: label }));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/settings-detail', params: { section } });
  }
});

it('opens account management from the profile row', async () => {
  mockAccount = { linked: true, deviceCount: 2 };
  await render(<SettingsScreen />);
  expect(screen.getByText('A', { includeHiddenElements: true })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: /Alex/ }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/settings-detail', params: { section: 'account' } });
});

it('keeps privacy and About details accessible', async () => {
  const view = await render(<SettingsDetailScreen section="privacy" />);
  expect(screen.getByText(PRIVACY_COPY)).toBeOnTheScreen();
  await view.rerender(<SettingsDetailScreen section="about" />);
  expect(screen.getByText('Your personal art journal.')).toBeOnTheScreen();
  for (const label of ['Privacy policy', 'Terms', 'Send feedback', 'Source code']) expect(screen.getByRole('button', { name: label })).toBeOnTheScreen();
});

it('shares confirmed works automatically even when an old local preference was off', async () => {
  await setSetting('sharing-default', 'false');
  await render(<SettingsDetailScreen section="contributions" />);
  expect(screen.queryByRole('switch')).toBeNull();
  expect(screen.getByText(/Saving a confirmed work shares/)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'My contributions (1)' })).toBeEnabled();
});

it('opens contributions and withdraws the selected work', async () => {
  await render(<SettingsDetailScreen section="contributions" />);
  await fireEvent.press(screen.getByRole('button', { name: 'My contributions (1)' }));
  expect(screen.getByText('Water Lilies')).toBeOnTheScreen();
  expect(screen.getByText('Shared · Tentative')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Withdraw' }));
  expect(mockWithdraw).toHaveBeenCalledWith({ contributionId: 'contribution-1' });
  expect(screen.getByText('Withdrawn')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
});

it('keeps withdrawal retryable when the network fails', async () => {
  mockWithdraw.mockRejectedValueOnce(new Error('offline'));
  await render(<SettingsDetailScreen section="contributions" />);
  await fireEvent.press(screen.getByRole('button', { name: 'My contributions (1)' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Withdraw' }));
  expect(screen.getByRole('alert')).toHaveTextContent(/Couldn't withdraw/);
  await fireEvent.press(screen.getByRole('button', { name: 'Withdraw' }));
  expect(screen.getByText('Withdrawn')).toBeOnTheScreen();
});

it('opens contextual sign-in while keeping the guest journal available', async () => {
  await render(<SettingsScreen />);
  expect(screen.getByText('Saved on this iPhone')).toBeOnTheScreen();
  expect(screen.queryByText(/sync across devices/i)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  expect(mockSignIn).not.toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/sign-in', params: { context: 'account' } });
});

it('shows account details and controls without device counts or sync copy', async () => {
  mockAccount = { linked: true, deviceCount: 2, email: 'visitor@example.com' };
  await render(<SettingsDetailScreen section="account" />);
  expect(screen.queryByText('Devices')).toBeNull();
  expect(screen.queryByText(/devices|sync privately/i)).toBeNull();
  expect(screen.getByText('visitor@example.com')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Delete account' })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
  expect(mockSignOut).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole('button', { name: 'Edit profile' }));
  expect(mockPush).toHaveBeenLastCalledWith('/edit-profile');
});

it('offers profile creation from account settings when the account has no profile yet', async () => {
  mockAccount = { linked: true, deviceCount: 1, email: 'visitor@example.com' };
  mockSessionStatus = 'profile-required';
  await render(<SettingsDetailScreen section="account" />);
  expect(screen.queryByRole('button', { name: 'Edit profile' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Create profile' }));
  expect(mockPush).toHaveBeenLastCalledWith('/create-profile');
});

it('shows pending contributions before device registration completes', async () => {
  mockReady = false;
  await setSetting('sharing-default', 'false');
  await render(<SettingsDetailScreen section="contributions" />);
  await fireEvent.press(screen.getByRole('button', { name: 'My contributions (…)' }));
  expect(screen.getByText('Connecting…')).toBeOnTheScreen();
});
