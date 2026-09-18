import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as settings from '@/db/repos/settings';
import { SyncPrompt } from './sync-prompt';

const mockSignIn = jest.fn();
let mockAccount = { account: { linked: false }, available: true, ready: true, busy: false, error: undefined as string | undefined, signInWithApple: mockSignIn };
jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
jest.mock('@/lib/account/use-account', () => ({ useAccount: () => mockAccount }));
jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationButtonType: { SIGN_IN: 0 }, AppleAuthenticationButtonStyle: { BLACK: 0 },
  AppleAuthenticationButton: ({ onPress }: { onPress: () => void }) => {
    const { Pressable, Text } = jest.requireActual('react-native');
    return <Pressable accessibilityRole="button" onPress={onPress}><Text>Sign in with Apple</Text></Pressable>;
  },
}));

beforeEach(async () => {
  jest.restoreAllMocks(); jest.clearAllMocks();
  mockAccount = { ...mockAccount, account: { linked: false }, available: true, ready: true, busy: false, error: undefined };
  await settings.removeSetting('sync-prompt-dismissed');
});

it('offers optional private sync and starts Apple sign-in only when chosen', async () => {
  await render(<SyncPrompt />);
  expect(await screen.findByText('Keep your collection across devices')).toBeOnTheScreen();
  expect(screen.getByText('Sign in to sync your saved art and visits. Your collection stays private.')).toBeOnTheScreen();
  expect(mockSignIn).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in with Apple' }));
  expect(mockSignIn).toHaveBeenCalledTimes(1);
});

it('remembers Not now across remounts without starting sign-in', async () => {
  const first = await render(<SyncPrompt />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Not now' }));
  await waitFor(() => expect(screen.queryByText('Keep your collection across devices')).toBeNull());
  expect(await settings.getSetting('sync-prompt-dismissed')).toBe('true');
  await first.unmount();
  await render(<SyncPrompt />);
  expect(screen.queryByText('Keep your collection across devices')).toBeNull();
  expect(mockSignIn).not.toHaveBeenCalled();
});

it('allows retrying a dismissal that could not be stored', async () => {
  jest.spyOn(settings, 'setSetting').mockRejectedValueOnce(new Error('disk full'));
  await render(<SyncPrompt />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Not now' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save your choice. Try again.');
  await fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
  await waitFor(() => expect(screen.queryByText('Keep your collection across devices')).toBeNull());
  expect(await settings.getSetting('sync-prompt-dismissed')).toBe('true');
});

it('does not show an offer when the dismissal preference cannot be read', async () => {
  jest.spyOn(settings, 'getSetting').mockRejectedValueOnce(new Error('unavailable'));
  await render(<SyncPrompt />);
  expect(screen.queryByText('Keep your collection across devices')).toBeNull();
});

it.each(['linked', 'unavailable', 'connecting'])('omits the prompt when %s', async (state) => {
  if (state === 'linked') mockAccount.account.linked = true;
  if (state === 'unavailable') mockAccount.available = false;
  if (state === 'connecting') mockAccount.ready = false;
  await render(<SyncPrompt />);
  expect(screen.queryByText('Keep your collection across devices')).toBeNull();
});

it('keeps sign-in failures retryable and removes the prompt after linking', async () => {
  mockAccount.error = 'Couldn’t update your account.';
  const view = await render(<SyncPrompt />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t update your account.');
  mockAccount.busy = true;
  await view.rerender(<SyncPrompt />);
  expect(screen.getByRole('button', { name: 'Not now' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Sign in with Apple' })).toBeNull();
  mockAccount = { ...mockAccount, busy: false, error: undefined, account: { linked: true } };
  await view.rerender(<SyncPrompt />);
  expect(screen.queryByText('Keep your collection across devices')).toBeNull();
});
