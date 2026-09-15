import { act, renderHook } from '@testing-library/react-native';
import { getFunctionName } from 'convex/server';
import { ConvexError } from 'convex/values';
import { api } from '../../../convex/_generated/api';
import { useCursorPages, useSocialQuery } from './use-social-query';
import type { PublicProfile } from './types';

let mockResults: Record<string, unknown>;
let mockRequests: Record<string, { query: unknown; args: { cursor?: string | null } }>;
const mockHttpQuery = jest.fn();
const mockClient = jest.fn();
jest.mock('@convex-dev/auth/react', () => ({ useAuthToken: () => 'token-a' }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('convex/browser', () => ({ ConvexHttpClient: function (url: string, options: object) {
  mockClient(url, options); return { query: mockHttpQuery };
} }));
jest.mock('convex/react', () => ({ useQueries: (requests: typeof mockRequests) => {
  mockRequests = requests;
  return Object.fromEntries(Object.entries(requests).map(([key, request]) => [key, mockResults[request.args.cursor ?? 'first']]));
} }));
const identify = (profile: PublicProfile) => profile.profileId;
const select = (result: { page: PublicProfile[]; cursor: string | null; isDone: boolean }) => result;
const page = (name: string, cursor: string | null, isDone = false) => ({
  page: [{ profileId: name, name, username: name, publishedWallCount: 0 }], cursor, isDone,
});
beforeEach(() => { jest.clearAllMocks(); mockResults = {}; mockRequests = {}; });

it('gates requests and clears content when the account changes or becomes unavailable', async () => {
  mockResults.first = page('alex', 'next');
  const view = await renderHook(({ scope, enabled }: { scope: string; enabled: boolean }) => useCursorPages(api.profiles.search,
    enabled ? { query: 'alex' } : 'skip', scope, select, identify), { initialProps: { scope: 'account-a', enabled: true } });
  expect(view.result.current.items[0].name).toBe('alex');
  await act(() => view.result.current.loadMore());
  expect(Object.values(mockRequests).map((request) => request.args.cursor)).toEqual([null, 'next']);
  mockResults = {};
  await view.rerender({ scope: 'account-b', enabled: true });
  expect(view.result.current.items).toEqual([]);
  expect(view.result.current.loading).toBe(true);
  expect(view.result.current.refreshing).toBe(false);
  expect(Object.values(mockRequests).map((request) => request.args.cursor)).toEqual([null]);
  await view.rerender({ scope: 'account-b', enabled: false });
  expect(mockRequests).toEqual({});
  expect(view.result.current.items).toEqual([]);
});

it('resets pagination and performs a fresh read on pull-to-refresh', async () => {
  mockResults = { first: page('alex', 'next'), next: page('bea', null, true) };
  const view = await renderHook(() => useCursorPages(api.profiles.search, { query: 'art' }, 'account-a', select, identify));
  await act(() => view.result.current.loadMore());
  expect(view.result.current.items.map((profile) => profile.name)).toEqual(['alex', 'bea']);
  let finish!: () => void;
  mockHttpQuery.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  await act(() => view.result.current.refresh());
  expect(view.result.current.items).toEqual([]);
  expect(view.result.current.loading).toBe(true);
  expect(view.result.current.refreshing).toBe(true);
  expect(mockRequests).toEqual({});
  expect(getFunctionName(mockHttpQuery.mock.calls[0][0])).toBe('profiles:search');
  expect(mockHttpQuery.mock.calls[0][1]).toEqual({ query: 'art', cursor: null, limit: 10 });
  await act(() => finish());
  expect(view.result.current.refreshing).toBe(false);
  expect(Object.values(mockRequests).map((request) => request.args.cursor)).toEqual([null]);
});

it('drops dependent subscriptions when reactive pagination cursors change', async () => {
  mockResults = { first: page('alex', 'old'), old: page('stale', null, true) };
  const view = await renderHook(() => useCursorPages(api.profiles.search, { query: 'art' }, 'account-a', select, identify));
  await act(() => view.result.current.loadMore());
  mockResults.first = page('new', 'new-cursor');
  await view.rerender({});
  expect(view.result.current.items.map((item) => item.name)).toEqual(['new']);
  expect(Object.values(mockRequests).map((request) => request.args.cursor)).toEqual([null]);
});

it('catches query errors and suppresses inaccessible data', async () => {
  mockResults.first = new ConvexError({ code: 'not_found' });
  const { result } = await renderHook(() => useSocialQuery(api.sharedVisits.getArtwork,
    { postId: 'post', itemId: 'item' as never }, 'account-a'));
  expect(result.current.data).toBeUndefined();
  expect(result.current.error).toBeInstanceOf(ConvexError);
});

it('ignores a stale refresh failure after changing the query scope', async () => {
  let reject!: (error: Error) => void;
  mockHttpQuery.mockImplementation(() => new Promise((_resolve, failure) => { reject = failure; }));
  const view = await renderHook(({ scope }: { scope: string }) => useSocialQuery(api.profiles.getPublic, { profileId: scope as never }, scope),
    { initialProps: { scope: 'old' } });
  await act(() => view.result.current.refresh());
  await view.rerender({ scope: 'new' });
  await act(() => reject(new Error('Old request failed')));
  expect(view.result.current.error).toBeUndefined();
});

it('restores the live subscription when arguments return during a refresh', async () => {
  mockResults.first = page('alex', null, true).page[0];
  mockHttpQuery.mockImplementation(() => new Promise(() => {}));
  const view = await renderHook(({ enabled }: { enabled: boolean }) => useSocialQuery(api.profiles.getPublic,
    enabled ? { profileId: 'alex' as never } : 'skip', 'account-a'), { initialProps: { enabled: true } });
  await act(() => view.result.current.refresh());
  expect(view.result.current.loading).toBe(true);
  await view.rerender({ enabled: false });
  await view.rerender({ enabled: true });
  expect(view.result.current.loading).toBe(false);
  expect(view.result.current.data).toMatchObject({ name: 'alex' });
  expect(Object.keys(mockRequests)).toHaveLength(1);
});

it('shows live data that arrives after a failed refresh instead of the stale error', async () => {
  mockResults.first = page('alex', null, true);
  mockHttpQuery.mockRejectedValue(new Error('Network request failed'));
  const view = await renderHook(() => useCursorPages(api.profiles.search, { query: 'art' }, 'account-a', select, identify));
  await act(() => view.result.current.refresh());
  expect(view.result.current.error).toBeUndefined();
  expect(view.result.current.items.map((profile) => profile.name)).toEqual(['alex']);
  mockResults.first = null;
  const single = await renderHook(() => useSocialQuery(api.profiles.getPublic, { profileId: 'gone' as never }, 'account-a'));
  await act(() => single.result.current.refresh());
  expect(single.result.current.error).toBeUndefined();
  expect(single.result.current.data).toBeNull();
});
