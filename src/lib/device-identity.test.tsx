import { act, renderHook } from '@testing-library/react-native';
import * as React from 'react';

const mockAuth = { isAuthenticated: false, isLoading: true };
const mockSignIn = jest.fn();
const mockRegister = jest.fn();
const mockChallenge = jest.fn();
const mockAttest = jest.fn();
const mockGetItem = jest.fn();
const mockSetItem = jest.fn();
const mockRandomBytes = jest.fn();
const mockStorage = new Map<string, string>();
const mockAppAttest = {
  isSupported: jest.fn(),
  generateKey: jest.fn(),
  attestKey: jest.fn(),
};

jest.mock('@convex-dev/auth/react', () => ({
  useAuthActions: () => ({ signIn: mockSignIn }),
}));
jest.mock('convex/react', () => ({
  useConvexAuth: () => mockAuth,
  useMutation: (ref: string) => ref === 'register' ? mockRegister : mockChallenge,
  useAction: () => mockAttest,
}));
jest.mock('../../convex/_generated/api', () => ({
  api: { devices: { registerDevice: 'register', createChallenge: 'challenge', attestDevice: 'attest' } },
}));
jest.mock('expo-device', () => ({ isDevice: false }));
jest.mock('expo-crypto', () => ({ getRandomBytesAsync: (...args: unknown[]) => mockRandomBytes(...args) }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: (...args: unknown[]) => mockGetItem(...args),
  setItemAsync: (...args: unknown[]) => mockSetItem(...args),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
}));
jest.mock('@/lib/app-attest', () => ({ getAppAttest: () => mockAppAttest }));

let useDeviceIdentity: typeof import('./device-identity').useDeviceIdentity;

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockAuth.isAuthenticated = false;
  mockAuth.isLoading = true;
  mockSignIn.mockResolvedValue({ signingIn: true });
  mockStorage.clear();
  mockGetItem.mockImplementation(async (key: string) => mockStorage.get(key) ?? null);
  mockSetItem.mockImplementation(async (key: string, value: string) => { mockStorage.set(key, value); });
  mockRandomBytes.mockResolvedValue(new Uint8Array(32).fill(0xa1));
  mockRegister.mockResolvedValue({ deviceId: 'device-1', attested: false, attestRequired: false });
  mockAppAttest.isSupported.mockReturnValue(false);
  // Each isolated module represents a fresh process; remounts within a test share its promises.
  jest.isolateModules(() => {
    jest.doMock('react', () => React);
    ({ useDeviceIdentity } = jest.requireActual<typeof import('./device-identity')>('./device-identity'));
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('waits for stored auth, signs in anonymously, and registers once across remounts', async () => {
  const first = await renderHook(useDeviceIdentity);
  expect(mockSignIn).not.toHaveBeenCalled();
  expect(mockRegister).not.toHaveBeenCalled();

  mockAuth.isLoading = false;
  await first.rerender(undefined);
  expect(mockSignIn).toHaveBeenCalledWith('anonymous', { secret: 'a1'.repeat(32) });
  expect(mockRegister).not.toHaveBeenCalled();

  mockAuth.isAuthenticated = true;
  await first.rerender(undefined);
  expect(mockRegister).toHaveBeenCalledWith({ platform: 'simulator', appAttestKeyId: undefined });
  await first.unmount();
  await renderHook(useDeviceIdentity);
  expect(mockRegister).toHaveBeenCalledTimes(1);
});

it('restores an existing session and passes the saved attestation key without signing in again', async () => {
  mockAuth.isLoading = false;
  mockAuth.isAuthenticated = true;
  mockGetItem.mockResolvedValue('saved-key');
  mockRegister.mockResolvedValue({ deviceId: 'device-1', attested: true, attestRequired: true });
  await renderHook(useDeviceIdentity);
  expect(mockSignIn).not.toHaveBeenCalled();
  expect(mockRegister).toHaveBeenCalledWith({ platform: 'simulator', appAttestKeyId: 'saved-key' });
  expect(mockAppAttest.attestKey).not.toHaveBeenCalled();
});

it('only requests attestation when the server requires it and the device supports it', async () => {
  mockAuth.isLoading = false;
  mockAuth.isAuthenticated = true;
  mockAppAttest.isSupported.mockReturnValue(true);
  await renderHook(useDeviceIdentity);
  expect(mockChallenge).not.toHaveBeenCalled();
});

it('stores a new key and completes required attestation using the server challenge', async () => {
  mockAuth.isLoading = false;
  mockAuth.isAuthenticated = true;
  mockRegister.mockResolvedValue({ deviceId: 'device-1', attested: false, attestRequired: true });
  mockAppAttest.isSupported.mockReturnValue(true);
  mockAppAttest.generateKey.mockResolvedValue('new-key');
  mockAppAttest.attestKey.mockResolvedValue('attestation');
  mockChallenge.mockResolvedValue({ nonce: 'nonce' });
  await renderHook(useDeviceIdentity);
  expect(mockSetItem).toHaveBeenCalledWith('appAttestKeyId', 'new-key');
  expect(mockAppAttest.attestKey).toHaveBeenCalledWith('new-key', 'nonce');
  expect(mockAttest).toHaveBeenCalledWith({ keyId: 'new-key', attestationBase64: 'attestation', nonce: 'nonce' });
});

it.each(['sign-in', 'registration'])('retries failed %s without needing a remount', async (stage) => {
  mockAuth.isLoading = false;
  mockAuth.isAuthenticated = stage === 'registration';
  const request = stage === 'registration' ? mockRegister : mockSignIn;
  request.mockRejectedValueOnce(new Error('offline'));
  await renderHook(useDeviceIdentity);
  expect(request).toHaveBeenCalledTimes(1);
  await act(() => jest.advanceTimersByTimeAsync(1000));
  expect(request).toHaveBeenCalledTimes(2);
});

it('registers again after the anonymous session changes', async () => {
  mockAuth.isLoading = false;
  mockAuth.isAuthenticated = true;
  const hook = await renderHook(useDeviceIdentity);
  mockAuth.isAuthenticated = false;
  await hook.rerender(undefined);
  mockAuth.isAuthenticated = true;
  await hook.rerender(undefined);
  expect(mockRegister).toHaveBeenCalledTimes(2);
});

it('reuses the installation credential after session expiry and a process restart', async () => {
  mockAuth.isLoading = false;
  const first = await renderHook(useDeviceIdentity);
  expect(mockSignIn).toHaveBeenLastCalledWith('anonymous', { secret: 'a1'.repeat(32) });
  mockAuth.isAuthenticated = true;
  await first.rerender(undefined);
  await first.unmount();

  mockAuth.isAuthenticated = false;
  jest.isolateModules(() => {
    ({ useDeviceIdentity } = jest.requireActual<typeof import('./device-identity')>('./device-identity'));
  });
  await renderHook(useDeviceIdentity);
  expect(mockSignIn).toHaveBeenCalledTimes(2);
  expect(mockSignIn).toHaveBeenLastCalledWith('anonymous', { secret: 'a1'.repeat(32) });
  expect(mockRandomBytes).toHaveBeenCalledTimes(1);
});

it('retries a failed sign-in with the credential already saved for that request', async () => {
  mockAuth.isLoading = false;
  mockSignIn.mockRejectedValueOnce(new Error('response lost'));
  await renderHook(useDeviceIdentity);
  await act(() => jest.advanceTimersByTimeAsync(1000));
  expect(mockSignIn.mock.calls).toEqual([
    ['anonymous', { secret: 'a1'.repeat(32) }],
    ['anonymous', { secret: 'a1'.repeat(32) }],
  ]);
  expect(mockRandomBytes).toHaveBeenCalledTimes(1);
});

it('waits for keychain persistence before making any sign-in request', async () => {
  mockAuth.isLoading = false;
  mockSetItem.mockRejectedValueOnce(new Error('keychain unavailable'));
  await renderHook(useDeviceIdentity);
  expect(mockSignIn).not.toHaveBeenCalled();
  await act(() => jest.advanceTimersByTimeAsync(1000));
  expect(mockSignIn).toHaveBeenCalledWith('anonymous', { secret: 'a1'.repeat(32) });
});
