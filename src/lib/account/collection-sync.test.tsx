import { act, render } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { CollectionSync, pauseCollectionSync, resumeCollectionSync } from './collection-sync';
import { requestCollectionSync } from './sync-events';

const mockSync = jest.fn();
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
  jest.useFakeTimers(); mockSync.mockReset().mockResolvedValue(undefined);
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
});

it('keeps imported data and its checkpoint dormant while signed out, then resumes after linking', async () => {
  mockAccount = { scope: 'a', accountId: null };
  const screen = await render(<CollectionSync />); await tick();
  requestCollectionSync(); await tick();
  expect(mockSync).not.toHaveBeenCalled();
  mockAccount = { scope: 'account:a,b', accountId: 'account' };
  await screen.rerender(<CollectionSync />); await tick();
  expect(mockSync).toHaveBeenCalledTimes(1);
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
