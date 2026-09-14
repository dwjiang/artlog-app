import { captureOwner, getLocalOwner, switchOwner } from './owner-store';
import { act, render } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { CollectionSync, pauseCollectionSync, resumeCollectionSync } from './collection-sync';
import { requestCollectionSync } from './sync-events';

const mockSync = jest.fn();
const mockPhotos = jest.fn();
const mockClaim = jest.fn();
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
jest.mock('@/lib/convex-client', () => ({ convex: { mutation: (...args: unknown[]) => mockClaim(...args) } }));
jest.mock('@/db/repos/saved-works', () => ({}));
jest.mock('@/db/repos/settings', () => ({ setSetting: async () => {} }));
jest.mock('@/db/repos/visits', () => ({}));
jest.mock('@/db/repos/journal-claim', () => ({ claimLocalJournal: async () => {} }));
jest.mock('./sync', () => ({ syncJournal: (...args: unknown[]) => mockSync(...args) }));

beforeEach(() => {
  jest.useFakeTimers(); mockSync.mockReset().mockResolvedValue(undefined); mockPhotos.mockReset().mockResolvedValue(undefined);
  mockClaim.mockReset().mockResolvedValue({ claimId: null, complete: true });
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

it('suspends capture scope until the account claim finishes and invalidates it on sign-out', async () => {
  switchOwner('device:test-installation', 'anonymous-scope');
  const before = captureOwner();
  let finish!: (value: { claimId: null; complete: boolean }) => void;
  mockClaim.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const screen = await render(<CollectionSync />); await tick();
  expect(before.isCurrent()).toBe(false);
  expect(captureOwner().scope).toBeUndefined();
  expect(getLocalOwner()).toBe('device:test-installation');
  await act(async () => finish({ claimId: null, complete: true }));
  expect(getLocalOwner()).toBe('account:account');
  const linked = captureOwner();
  mockAccount = { scope: 'anonymous-next', accountId: null };
  await screen.rerender(<CollectionSync />);
  expect(linked.isCurrent()).toBe(false);
  expect(getLocalOwner()).toBe('device:test-installation');
});
