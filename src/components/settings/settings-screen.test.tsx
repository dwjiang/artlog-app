import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { SettingsDetailScreen } from './settings-detail-screen';
import { SettingsScreen } from './settings-screen';
import { setSetting } from '@/db/repos/settings';

const mockPush = jest.fn();
const mockWithdraw = jest.fn();
const mockSignOut = jest.fn();
const mockSignIn = jest.fn();
const mockDelete = jest.fn();
let mockAccount: { linked: boolean; deviceCount: number; email?: string } | null | undefined = null;
let mockReady = true;
let mockBusy = false;
let mockSessionStatus = 'ready';
let mockOffline = false;
const contribution = {
  contributionId: 'contribution-1', status: 'tentative', fields: { title: { value: 'Water Lilies' }, artist: { value: 'Claude Monet' } },
};

jest.mock('./leaderboard-preference', () => ({ LeaderboardPreference: () => null }));
jest.mock('@/lib/social/use-social-session', () => ({ useSocialSession: () => ({ status: mockSessionStatus, key: 'settings', offline: mockOffline }) }));
jest.mock('@/lib/social/use-social-query', () => ({ useSocialQuery: () => ({ data: mockAccount?.linked ? { name: 'Alex', username: 'alex' } : undefined }) }));
jest.mock('expo-network', () => ({ useNetworkState: () => ({ isConnected: !mockOffline, isInternetReachable: !mockOffline }) }));
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

async function confirmDestructive() {
  const button = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.find((entry) => entry.style === 'destructive');
  expect(button).toBeDefined();
  await act(() => button?.onPress?.());
}
beforeEach(async () => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.clearAllMocks(); mockAccount = null; mockReady = true; mockBusy = false; mockSessionStatus = 'ready'; mockOffline = false;
  mockWithdraw.mockResolvedValue(null);
});

it('shows grouped settings and opens the matching detail', async () => {
  await render(<SettingsScreen />);
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeOnTheScreen();
  expect(screen.queryByText('YA', { includeHiddenElements: true })).toBeNull();
  for (const title of ['Settings', 'Your journal', 'Artlog', 'Developer']) expect(screen.getByRole('header', { name: title })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Export journal' })).toBeNull();
  for (const [label, section] of [['General', 'general'], ['Visits', 'visits'], ['Privacy', 'privacy'], ['About', 'about']]) {
    await fireEvent.press(screen.getByRole('button', { name: label }));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/settings-detail', params: { section } });
  }
  await fireEvent.press(screen.getByRole('button', { name: 'Widgets' }));
  expect(mockPush).toHaveBeenLastCalledWith('/widgets');
});

it('opens measurement units in General', async () => {
  await render(<SettingsDetailScreen section="general" />);
  expect(screen.getByRole('header', { name: 'Measurement units' })).toBeOnTheScreen();
  expect(await screen.findByRole('button', { name: 'Metric', selected: true })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Imperial' })).toBeOnTheScreen();
});

it('opens account management from the profile row', async () => {
  mockAccount = { linked: true, deviceCount: 2 };
  await render(<SettingsScreen />);
  expect(screen.queryByRole('button', { name: 'Export journal' })).toBeNull();
  expect(screen.getByText('A', { includeHiddenElements: true })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: /Alex/ }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/settings-detail', params: { section: 'account' } });
});

it('keeps privacy and About details accessible', async () => {
  const view = await render(<SettingsDetailScreen section="privacy" />);
  expect(screen.getByText(/Apple Maps searches may send a search area centered on your location to Apple/)).toBeOnTheScreen();
  expect(screen.getByText(/Artlog’s servers receive the selected museum, but not your GPS coordinates/)).toBeOnTheScreen();
  expect(screen.getByText(/Confirming a new place also sends that place’s name, coordinates and website to Artlog/)).toBeOnTheScreen();
  expect(screen.getByText(/sends only the label’s text/)).toBeOnTheScreen();
  expect(screen.getByText(/Camera and location metadata are removed/)).toBeOnTheScreen();
  await view.rerender(<SettingsDetailScreen section="about" />);
  expect(screen.getByRole('header', { name: 'Artlog' })).toBeOnTheScreen();
  for (const label of ['Privacy policy', 'Send feedback', 'Source code']) expect(screen.getByRole('button', { name: label })).toBeOnTheScreen();
});

it('shares confirmed works automatically even when an old local preference was off', async () => {
  await setSetting('sharing-default', 'false');
  await render(<SettingsDetailScreen section="contributions" />);
  expect(screen.queryByRole('switch')).toBeNull();
  expect(screen.getByText(/Saving a confirmed work shares/)).toBeOnTheScreen();
  expect(screen.getByText('Water Lilies')).toBeOnTheScreen();
});

it('opens contributions and withdraws the selected work', async () => {
  await render(<SettingsDetailScreen section="contributions" />);
  expect(screen.getByText('Water Lilies')).toBeOnTheScreen();
  expect(screen.getByText('Shared · Tentative')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Withdraw' }));
  await confirmDestructive();
  expect(mockWithdraw).toHaveBeenCalledWith({ contributionId: 'contribution-1' });
  expect(screen.getByText('Withdrawn')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
});

it('keeps withdrawal retryable when the network fails', async () => {
  mockWithdraw.mockRejectedValueOnce(new Error('offline'));
  await render(<SettingsDetailScreen section="contributions" />);
  await fireEvent.press(screen.getByRole('button', { name: 'Withdraw' }));
  await confirmDestructive();
  expect(screen.getByRole('alert')).toHaveTextContent(/Couldn't withdraw/);
  await fireEvent.press(screen.getByRole('button', { name: 'Withdraw' }));
  await confirmDestructive();
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

it('holds the account row behind a ghost only while the account can still load', async () => {
  mockAccount = undefined;
  const view = await render(<SettingsDetailScreen section="account" />);
  expect(screen.getByRole('progressbar', { name: 'Loading account' })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Sign in to Artlog' })).toBeNull();
  mockOffline = true;
  await view.rerender(<SettingsDetailScreen section="account" />);
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.getByRole('button', { name: 'Sign in to Artlog' })).toBeEnabled();
});

it('shows account details and controls without device counts or sync copy', async () => {
  mockAccount = { linked: true, deviceCount: 2, email: 'visitor@example.com' };
  await render(<SettingsDetailScreen section="account" />);
  expect(screen.queryByText('Devices')).toBeNull();
  expect(screen.queryByText(/devices|sync privately/i)).toBeNull();
  expect(screen.getByText('visitor@example.com')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Delete account' })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
  expect(mockSignOut).not.toHaveBeenCalled();
  await confirmDestructive();
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
  expect(screen.getByLabelText('Loading contributions…')).toBeOnTheScreen();
});

it('reports contributions as unavailable offline instead of loading indefinitely', async () => {
  mockReady = false; mockOffline = true;
  await render(<SettingsDetailScreen section="contributions" />);
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.getByText('Connect to see your contributions.')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Loading contributions…')).toBeNull();
});
