import { act, render } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { CollectionSync, pauseCollectionSync, resumeCollectionSync } from './collection-sync';
import { requestCollectionSync } from './sync-events';

const mockSync = jest.fn();
const mockPhotos = jest.fn();
jest.mock('@convex-dev/auth/react', () => ({ useAuthToken: () => 'token' }));
jest.mock('./photo-sync', () => ({ syncCollectionPhotos: (...args: unknown[]) => mockPhotos(...args) }));
let mockAccount: { scope: string; accountId: string | null };
let mockNetwork: (state: { isConnected: boolean }) => void;
let mockForeground: (state: AppStateStatus) => void;
jest.mock('@/lib/use-device-ready', () => ({ useDeviceReady: () => true }));
jest.mock('convex/react', () => ({ useQuery: (fn: unknown) =>
  jest.requireActual('convex/server').getFunctionName(fn) === 'devices:me' ? { deviceId: 'a' } : mockAccount,
}));
jest.mock('expo-network', () => ({ addNetworkStateListener: (callback: typeof mockNetwork) => {
  mockNetwork = callback; return { remove: jest.fn() };
} }));
jest.mock('@/lib/convex-client', () => ({ convex: {} }));
jest.mock('@/db/repos/saved-works', () => ({}));
jest.mock('@/db/repos/settings', () => ({}));
jest.mock('./sync', () => ({ syncCollection: (...args: unknown[]) => mockSync(...args) }));

beforeEach(() => {
  jest.useFakeTimers(); mockSync.mockReset().mockResolvedValue(undefined); mockPhotos.mockReset().mockResolvedValue(undefined);
  mockAccount = { scope: 'account:a,b', accountId: 'account' };
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    mockForeground = listener; return { remove: jest.fn() };
  });
  resumeCollectionSync();
});
afterEach(() => { pauseCollectionSync(); jest.restoreAllMocks(); jest.useRealTimers(); });
const tick = async () => { await act(() => jest.advanceTimersByTimeAsync(500)); };

it('syncs on launch, local changes, foreground and reconnect', async () => {
  await render(<CollectionSync />); await tick();
  expect(mockSync).toHaveBeenCalledTimes(1);
  requestCollectionSync(); await tick();
  mockForeground('active'); await tick();
  mockNetwork({ isConnected: true }); await tick();
  expect(mockSync).toHaveBeenCalledTimes(4);
  await tick();
  expect(mockPhotos).toHaveBeenCalledTimes(4);
});

it('keeps syncing notes while a photo transfer runs and retries a failed transfer on its own', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  let finishTransfer!: () => void;
  mockPhotos.mockImplementationOnce(() => new Promise<void>((resolve) => { finishTransfer = resolve; }));
  await render(<CollectionSync />); await tick(); await tick();
  expect(mockPhotos).toHaveBeenCalledTimes(1);
  requestCollectionSync(); await tick();
  expect(mockSync).toHaveBeenCalledTimes(2);
  expect(mockPhotos).toHaveBeenCalledTimes(1);
  mockPhotos.mockRejectedValueOnce(new Error('offline'));
  await act(async () => finishTransfer()); await tick();
  expect(mockPhotos).toHaveBeenCalledTimes(2);
  await act(() => jest.advanceTimersByTimeAsync(30_000));
  expect(mockPhotos).toHaveBeenCalledTimes(3);
  expect(mockSync).toHaveBeenCalledTimes(2);
});

it('backs up the registered device before Apple sign-in and switches scope after linking', async () => {
  mockAccount = { scope: 'a', accountId: null };
  const screen = await render(<CollectionSync />); await tick();
  requestCollectionSync(); await tick();
  expect(mockSync).toHaveBeenCalledTimes(2);
  expect(mockSync.mock.calls[0][1]).toMatchObject({ deviceId: 'a', accountId: null });
  mockAccount = { scope: 'account:a,b', accountId: 'account' };
  await screen.rerender(<CollectionSync />); await tick();
  expect(mockSync).toHaveBeenCalledTimes(3);
});

it('invalidates an outstanding response immediately without waiting for an offline request', async () => {
  let finish!: () => void;
  mockSync.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  await render(<CollectionSync />); await tick();
  const isCurrent = mockSync.mock.calls[0][2] as () => boolean;
  expect(isCurrent()).toBe(true);
  expect(pauseCollectionSync()).toBeUndefined();
  expect(isCurrent()).toBe(false);
  await act(async () => finish());
});
