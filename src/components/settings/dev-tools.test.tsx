import { fireEvent, render, screen } from '@testing-library/react-native';

import { DevTools } from './dev-tools';

const mockSignPayload = jest.fn();
const mockAssertSmoke = jest.fn();
const mockGetAppAttest = jest.fn();

jest.mock('@expo/ui', () => {
  const { Pressable, Text, View } = jest.requireActual('react-native');
  return {
    Host: View,
    Button: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) => (
      <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}>
        <Text>{label}</Text>
      </Pressable>
    ),
  };
});
jest.mock('convex/react', () => ({ useMutation: () => mockAssertSmoke }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/lib/app-attest', () => ({ getAppAttest: () => mockGetAppAttest() }));
jest.mock('@/lib/attested-write', () => ({ signPayload: (...args: unknown[]) => mockSignPayload(...args) }));

beforeEach(() => {
  jest.resetAllMocks();
  mockGetAppAttest.mockReturnValue({});
  mockSignPayload.mockResolvedValue({ nonce: 'nonce', assertionBase64: 'assertion', payloadJson: '{}' });
});

it('shows accepted and rejected replay results using the exact same signed request', async () => {
  mockAssertSmoke.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false });
  await render(<DevTools attested />);
  await fireEvent.press(screen.getByRole('button', { name: 'Check App Attest' }));
  expect(screen.getByText('Assertion: accepted · Replay: rejected')).toBeOnTheScreen();
  expect(mockSignPayload).toHaveBeenCalledTimes(1);
  expect(mockAssertSmoke.mock.calls).toEqual([
    [{ nonce: 'nonce', assertionBase64: 'assertion', payloadJson: '{}' }],
    [{ nonce: 'nonce', assertionBase64: 'assertion', payloadJson: '{}' }],
  ]);
});

it('disables the check while registration is pending and on unsupported devices', async () => {
  const result = await render(<DevTools attested={false} />);
  expect(screen.getByRole('button', { name: 'Check App Attest' })).toBeDisabled();
  mockGetAppAttest.mockReturnValue(null);
  await result.rerender(<DevTools attested />);
  expect(screen.getByText('App Attest: unsupported on this device')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Check App Attest' })).toBeDisabled();
  expect(mockSignPayload).not.toHaveBeenCalled();
});

it('shows signing errors and makes the check available again', async () => {
  mockSignPayload.mockRejectedValue(new Error('Device key unavailable'));
  await render(<DevTools attested />);
  await fireEvent.press(screen.getByRole('button', { name: 'Check App Attest' }));
  expect(screen.getByText('Device key unavailable')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Check App Attest' })).toBeEnabled();
  expect(mockAssertSmoke).not.toHaveBeenCalled();
});
