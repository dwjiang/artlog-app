import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { SettingsDetailScreen } from './settings-detail-screen';
import { SettingsScreen } from './settings-screen';
import { SHARING_SETTING } from './sharing-section';
import { PRIVACY_COPY } from './privacy-section';
import { LabelActions, SHARE_BUTTON } from '@/components/scan/label/label-actions';
import { getSharingDefault, setSharingDefault } from '@/lib/settings/sharing';
import { setSetting } from '@/db/repos/settings';

const mockPush = jest.fn();
const mockWithdraw = jest.fn();
const mockSignOut = jest.fn();
const mockSignIn = jest.fn();
const mockDelete = jest.fn();
let mockAccount: { linked: boolean; deviceCount: number; email?: string } | null = null;
let mockReady = true;
let mockBusy = false;
const contribution = {
  contributionId: 'contribution-1', status: 'tentative', fields: { title: { value: 'Water Lilies' }, artist: { value: 'Claude Monet' } },
};

jest.mock('./leaderboard-preference', () => ({ LeaderboardPreference: () => null }));
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
  jest.clearAllMocks(); mockAccount = null; mockReady = true; mockBusy = false;
  mockWithdraw.mockResolvedValue(null);
  await setSharingDefault(true);
});

it('shows grouped settings and opens the matching detail', async () => {
  await render(<SettingsScreen />);
  for (const title of ['Preferences', 'Sharing', 'Your data', 'Developer']) expect(screen.getByRole('header', { name: title })).toBeOnTheScreen();
  for (const [label, section] of [['Visits', 'visits'], ['Privacy', 'privacy'], ['Export journal', 'export'], ['About Artlog', 'about']]) {
    await fireEvent.press(screen.getByRole('button', { name: label }));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/settings-detail', params: { section } });
  }
});

it('keeps privacy and About details accessible', async () => {
  const view = await render(<SettingsDetailScreen section="privacy" />);
  expect(screen.getByText(PRIVACY_COPY)).toBeOnTheScreen();
  await view.rerender(<SettingsDetailScreen section="about" />);
  expect(screen.getByText('Connected')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Source code' })).toBeOnTheScreen();
});

it('persists sharing off and hides the offer when returning to a label review', async () => {
  const settings = await render(<SettingsDetailScreen section="contributions" />);
  const toggle = screen.getByRole('switch', { name: SHARING_SETTING });
  await waitFor(() => expect(toggle).toBeChecked());
  await fireEvent.press(toggle);
  await waitFor(() => expect(toggle).not.toBeChecked());
  expect(await getSharingDefault()).toBe(false);
  await settings.unmount();
  const review = await render(<LabelActions canSave canShare saving={false} sharing={false} onSave={jest.fn()} onShare={jest.fn()} onViewSaved={jest.fn()} />);
  expect(screen.queryByRole('button', { name: SHARE_BUTTON })).toBeNull();
  expect(screen.getByRole('button', { name: 'Save to collection' })).toBeEnabled();
  await review.unmount();
  await render(<SettingsDetailScreen section="contributions" />);
  await waitFor(() => expect(screen.getByRole('switch', { name: SHARING_SETTING })).toBeEnabled());
  expect(screen.getByRole('switch', { name: SHARING_SETTING })).not.toBeChecked();
});

it('updates a mounted label review when sharing is reenabled', async () => {
  await setSharingDefault(false);
  await render(<><SettingsDetailScreen section="contributions" /><LabelActions canSave canShare saving={false} sharing={false} onSave={jest.fn()} onShare={jest.fn()} onViewSaved={jest.fn()} /></>);
  const toggle = screen.getByRole('switch', { name: SHARING_SETTING });
  await waitFor(() => expect(toggle).toBeEnabled());
  expect(screen.queryByRole('button', { name: SHARE_BUTTON })).toBeNull();
  await fireEvent.press(toggle);
  expect(await screen.findByRole('button', { name: SHARE_BUTTON })).toBeEnabled();
  expect(await getSharingDefault()).toBe(true);
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

it('opens the shared sign-in sheet from the account row', async () => {
  await render(<SettingsScreen />);
  await fireEvent.press(screen.getByRole('button', { name: /Sign in to Artlog/ }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/sign-in', params: { context: 'account' } });
});

it('shows linked devices and preserves sign-out and account deletion controls', async () => {
  mockAccount = { linked: true, deviceCount: 2, email: 'visitor@example.com' };
  await render(<SettingsDetailScreen section="account" />);
  expect(screen.getByText('2 devices')).toBeOnTheScreen();
  expect(screen.getByText('visitor@example.com')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Delete account' })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
  expect(mockSignOut).toHaveBeenCalledTimes(1);
});

it('keeps local choices available before device registration completes', async () => {
  mockReady = false;
  await setSetting('sharing-default', 'false');
  await render(<SettingsDetailScreen section="contributions" />);
  await waitFor(() => expect(screen.getByRole('switch', { name: SHARING_SETTING })).toBeEnabled());
  await fireEvent.press(screen.getByRole('button', { name: 'My contributions (…)' }));
  expect(screen.getByText('Connecting…')).toBeOnTheScreen();
});
