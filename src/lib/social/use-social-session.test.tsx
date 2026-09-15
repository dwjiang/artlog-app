import { act, renderHook } from '@testing-library/react-native';
import type { FunctionReference } from 'convex/server';
import { ConvexError } from 'convex/values';
import { switchOwner } from '../account/owner-store';
import { useSocialSession } from './use-social-session';

let mockReady = true;
let mockToken: string | null = 'token';
let mockOffline = false;
let mockAccount: unknown;
let mockMine: unknown;
const mockRead = jest.fn();
jest.mock('@convex-dev/auth/react', () => ({ useAuthToken: () => mockToken }));
jest.mock('expo-network', () => ({ useNetworkState: () => ({ isConnected: !mockOffline }) }));
jest.mock('../use-device-ready', () => ({ useDeviceReady: () => mockReady }));
jest.mock('./use-social-query', () => ({ useSocialQuery: (query: FunctionReference<'query'>, args: unknown) => {
  const name = jest.requireActual('convex/server').getFunctionName(query); mockRead(name, args);
  const value = args === 'skip' ? undefined : name === 'accounts:me' ? mockAccount : mockMine;
  return { data: value instanceof Error ? undefined : value, error: value instanceof Error ? value : undefined, refresh: jest.fn() };
} }));

beforeEach(() => {
  jest.clearAllMocks(); mockReady = true; mockToken = 'token'; mockOffline = false;
  switchOwner('account:a', 'scope-a');
  mockAccount = { linked: true, accountId: 'a', scope: 'scope-a' };
  mockMine = { profileId: 'profile-a', scope: 'scope-a' };
});

it('waits for device, token, local account and server scope before querying the wall', async () => {
  mockReady = false;
  const view = await renderHook(useSocialSession);
  expect(mockRead).toHaveBeenCalledWith('accounts:me', 'skip');
  expect(mockRead).toHaveBeenCalledWith('walls:getMine', 'skip');
  mockReady = true; mockToken = null;
  await view.rerender({});
  expect(view.result.current.status).toBe('loading');
  mockToken = 'token';
  await act(() => switchOwner('account:a', 'different-scope'));
  expect(mockRead).toHaveBeenLastCalledWith('walls:getMine', 'skip');
  await act(() => switchOwner('account:a', 'scope-a'));
  expect(view.result.current.status).toBe('ready');
});

it('clears identity on account changes, sign-out, and offline transitions', async () => {
  const view = await renderHook(useSocialSession);
  expect(view.result.current.profileId).toBe('profile-a');
  await act(() => switchOwner('account:b', 'scope-b'));
  expect(view.result.current.profileId).toBeUndefined();
  mockAccount = { linked: false, scope: 'device-scope' };
  await act(() => switchOwner('device:test-installation', 'device-scope'));
  expect(view.result.current.status).toBe('signed-out');
  mockOffline = true;
  await view.rerender({});
  expect(view.result.current.status).toBe('offline');
  expect(mockRead).toHaveBeenLastCalledWith('walls:getMine', 'skip');
});

it('offers profile creation only for profile_required and reports other failures', async () => {
  mockMine = new ConvexError({ code: 'profile_required' });
  const view = await renderHook(useSocialSession);
  expect(view.result.current.status).toBe('profile-required');
  mockMine = new ConvexError({ code: 'not_found' });
  await view.rerender({});
  expect(view.result.current.status).toBe('error');
});
