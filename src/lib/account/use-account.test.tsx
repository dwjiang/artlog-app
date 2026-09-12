import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useAccount } from './use-account';

const mockMutation = jest.fn();
const mockSignIn = jest.fn();
const mockEndSession = jest.fn();
const mockAnonymous = jest.fn();
const mockApple = jest.fn();
const mockSignPayload = jest.fn();
const mockPause = jest.fn();
const mockResume = jest.fn();

jest.mock('@convex-dev/auth/react', () => ({ useAuthActions: () => ({ signIn: mockSignIn, signOut: mockEndSession }) }));
jest.mock('convex/react', () => ({ useQuery: () => ({ linked: false, deviceCount: 0 }) }));
jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: async () => true,
  signInAsync: (args: unknown) => mockApple(args),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));
jest.mock('@/lib/use-device-ready', () => ({ useDeviceReady: () => true }));
jest.mock('@/lib/convex-client', () => ({ convex: { mutation: (fn: unknown, args: unknown) => mockMutation(jest.requireActual('convex/server').getFunctionName(fn), args) } }));
jest.mock('@/lib/attested-write', () => ({ signPayload: (args: unknown) => mockSignPayload(args) }));
jest.mock('@/lib/device-identity', () => ({ signInAnonymously: (signIn: unknown) => mockAnonymous(signIn) }));
jest.mock('./collection-sync', () => ({ pauseCollectionSync: () => mockPause(), resumeCollectionSync: () => mockResume() }));

beforeEach(() => {
  jest.resetAllMocks();
  mockMutation.mockResolvedValue({ nonce: 'apple-nonce' });
  mockApple.mockResolvedValue({ identityToken: 'apple-token', user: 'apple-user' });
  mockSignPayload.mockResolvedValue({ nonce: 'assertion-nonce', assertionBase64: 'assertion' });
});

it('passes the challenge to native Apple sign-in and links after provider verification', async () => {
  const { result } = await renderHook(useAccount);
  await waitFor(() => expect(result.current.available).toBe(true));
  await act(() => result.current.signInWithApple());
  expect(mockApple).toHaveBeenCalledWith({ nonce: 'apple-nonce', requestedScopes: [0, 1] });
  expect(mockSignIn).toHaveBeenCalledWith('apple-native', { identityToken: 'apple-token', nonce: 'apple-nonce' });
  expect(mockSignPayload).toHaveBeenCalledWith({ action: 'linkAccount', appleUserId: 'apple-user' });
  expect(mockMutation).toHaveBeenLastCalledWith('accounts:linkAccount', { appleUserId: 'apple-user', nonce: 'assertion-nonce', assertionBase64: 'assertion' });
  expect(mockPause).toHaveBeenCalledTimes(1); expect(mockResume).toHaveBeenCalledTimes(1);
});

it('treats Apple cancellation as a normal dismissal without linking', async () => {
  mockApple.mockRejectedValueOnce({ code: 'ERR_REQUEST_CANCELED' });
  const { result } = await renderHook(useAccount);
  await act(() => result.current.signInWithApple());
  expect(result.current.error).toBeUndefined(); expect(result.current.busy).toBe(false);
  expect(mockSignIn).not.toHaveBeenCalled(); expect(mockSignPayload).not.toHaveBeenCalled();
});

it('does not link when token verification fails', async () => {
  mockSignIn.mockRejectedValueOnce(new Error('invalid audience'));
  const { result } = await renderHook(useAccount);
  await act(() => result.current.signInWithApple());
  expect(result.current.error).toContain('try again');
  expect(mockSignPayload).not.toHaveBeenCalled(); expect(mockResume).toHaveBeenCalled();
});

it('unlinks before ending the session and restoring the anonymous device identity', async () => {
  const { result } = await renderHook(useAccount);
  await act(() => result.current.signOut());
  expect(mockMutation).toHaveBeenCalledWith('accounts:unlink', {});
  expect(mockEndSession).toHaveBeenCalledTimes(1);
  expect(mockAnonymous).toHaveBeenCalledWith(mockSignIn);
  expect(mockMutation.mock.invocationCallOrder[0]).toBeLessThan(mockEndSession.mock.invocationCallOrder[0]);
  expect(mockEndSession.mock.invocationCallOrder[0]).toBeLessThan(mockAnonymous.mock.invocationCallOrder[0]);
});

it('leaves the session intact when unlink fails', async () => {
  mockMutation.mockRejectedValueOnce(new Error('offline'));
  const { result } = await renderHook(useAccount);
  await act(() => result.current.signOut());
  expect(mockEndSession).not.toHaveBeenCalled(); expect(mockAnonymous).not.toHaveBeenCalled();
  expect(result.current.error).toContain('try again');
});

it('deletes the account before restoring the anonymous device identity', async () => {
  const { result } = await renderHook(useAccount);
  await act(() => result.current.deleteAccount());
  expect(mockMutation).toHaveBeenCalledWith('accounts:deleteAccount', {});
  expect(mockAnonymous).toHaveBeenCalledWith(mockSignIn);
});
