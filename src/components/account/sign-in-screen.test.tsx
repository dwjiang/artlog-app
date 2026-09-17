import { fireEvent, render, screen } from '@testing-library/react-native';
import { SignInScreen } from './sign-in-screen';

const mockBack = jest.fn(), mockSignIn = jest.fn();
const mockRouter = { back: mockBack };
let mockAccount = { account: { linked: false }, available: true, busy: false, error: undefined as string | undefined, ready: true, signInWithApple: mockSignIn };
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/lib/account/use-account', () => ({ useAccount: () => mockAccount }));
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, Stack: { Screen: () => null } }));
jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationButtonType: { SIGN_IN: 0 }, AppleAuthenticationButtonStyle: { BLACK: 0 },
  AppleAuthenticationButton: ({ onPress }: { onPress: () => void }) => {
    const { Pressable, Text } = jest.requireActual('react-native');
    return <Pressable accessibilityRole="button" onPress={onPress}><Text>Sign in with Apple</Text></Pressable>;
  },
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockAccount = { ...mockAccount, account: { linked: false }, busy: false, ready: true, available: true, error: undefined };
});
it('shows context, starts Apple sign-in, and lets a guest dismiss', async () => {
  await render(<SignInScreen context="wall" />);
  expect(screen.getByRole('header', { name: 'Sign in to share your wall' })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in with Apple' }));
  expect(mockSignIn).toHaveBeenCalledTimes(1);
  expect(mockBack).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
  expect(mockBack).toHaveBeenCalledTimes(1);
});
it('keeps sign-in errors retryable and closes only after linking finishes', async () => {
  mockAccount.error = 'Couldn’t update your account.';
  const view = await render(<SignInScreen />);
  expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t update your account.');
  mockAccount = { ...mockAccount, busy: true, account: { linked: true } };
  await view.rerender(<SignInScreen />);
  expect(screen.getByRole('button', { name: 'Not now' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Sign in with Apple' })).toBeNull();
  expect(mockBack).not.toHaveBeenCalled();
  mockAccount.busy = false;
  await view.rerender(<SignInScreen />);
  expect(mockBack).toHaveBeenCalledTimes(1);
});
it('introduces all three features and one Apple action in the welcome sheet', async () => {
  await render(<SignInScreen welcome />);
  for (const text of ['Welcome to Artlog', 'Scan the label', 'Hang your wall', 'Follow friends']) expect(screen.getByText(text)).toBeOnTheScreen();
  expect(screen.getAllByRole('button', { name: 'Sign in with Apple' })).toHaveLength(1);
});
it('explains unavailable sign-in without preventing dismissal', async () => {
  mockAccount.available = false;
  await render(<SignInScreen />);
  expect(screen.getByText('Apple sign-in is unavailable on this device.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Not now' })).toBeEnabled();
});
