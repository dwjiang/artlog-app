import { getRandomBytesAsync } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { getDeviceAuthSecret } from './device-credentials';

jest.mock('expo-crypto', () => ({ getRandomBytesAsync: jest.fn() }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
}));

const randomBytes = jest.mocked(getRandomBytesAsync);
const getItem = jest.mocked(SecureStore.getItemAsync);
const setItem = jest.mocked(SecureStore.setItemAsync);

beforeEach(() => jest.resetAllMocks());

it('persists a 256-bit credential on this device before returning it for sign-in', async () => {
  getItem.mockResolvedValue(null);
  randomBytes.mockResolvedValue(new Uint8Array(32).fill(0xa1));
  let finishWrite!: () => void;
  setItem.mockImplementation(() => new Promise<void>((resolve) => { finishWrite = resolve; }));
  let returned = false;
  const pending = getDeviceAuthSecret().then((secret) => { returned = true; return secret; });
  await Promise.resolve();
  await Promise.resolve();

  expect(randomBytes).toHaveBeenCalledWith(32);
  expect(setItem).toHaveBeenCalledWith('deviceAuthSecret', 'a1'.repeat(32), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  expect(returned).toBe(false);
  finishWrite();
  await expect(pending).resolves.toBe('a1'.repeat(32));
});

it('uses the saved credential without generating or overwriting it', async () => {
  getItem.mockResolvedValue('b2'.repeat(32));
  await expect(getDeviceAuthSecret()).resolves.toBe('b2'.repeat(32));
  expect(randomBytes).not.toHaveBeenCalled();
  expect(setItem).not.toHaveBeenCalled();
});

it('propagates a keychain read failure without replacing the identity', async () => {
  getItem.mockRejectedValue(new Error('keychain unavailable'));
  await expect(getDeviceAuthSecret()).rejects.toThrow('keychain unavailable');
  expect(randomBytes).not.toHaveBeenCalled();
  expect(setItem).not.toHaveBeenCalled();
});

it('does not return a credential when persistence fails', async () => {
  getItem.mockResolvedValue(null);
  randomBytes.mockResolvedValue(new Uint8Array(32).fill(0xa1));
  setItem.mockRejectedValue(new Error('keychain write failed'));
  await expect(getDeviceAuthSecret()).rejects.toThrow('keychain write failed');
});
