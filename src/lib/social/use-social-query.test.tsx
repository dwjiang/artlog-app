import { reportError } from '@/lib/observability';
import { act, renderHook } from '@testing-library/react-native';
import { getFunctionName } from 'convex/server';
import { ConvexError } from 'convex/values';
import { api } from '../../../convex/_generated/api';
import { useCursorPages, useSocialQuery } from './use-social-query';
import type { PublicProfile } from './types';

jest.mock('@/lib/observability', () => ({ reportError: jest.fn() }));
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

it('keeps delivered pages on screen through a pull-to-refresh, then restarts from the first page', async () => {
  mockResults = { first: page('alex', 'next'), next: page('bea', null, true) };
  const view = await renderHook(() => useCursorPages(api.profiles.search, { query: 'art' }, 'account-a', select, identify));
  await act(() => view.result.current.loadMore());
  expect(view.result.current.items.map((profile) => profile.name)).toEqual(['alex', 'bea']);
  let finish!: () => void;
  mockHttpQuery.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  await act(() => view.result.current.refresh());
  expect(view.result.current.items.map((profile) => profile.name)).toEqual(['alex', 'bea']);
  expect(view.result.current.first).toEqual(page('alex', 'next'));
  expect(view.result.current.loading).toBe(true);
  expect(view.result.current.refreshing).toBe(true);
  expect(view.result.current.canLoadMore).toBe(false);
  expect(mockRequests).toEqual({});
  expect(getFunctionName(mockHttpQuery.mock.calls[0][0])).toBe('profiles:search');
  expect(mockHttpQuery.mock.calls[0][1]).toEqual({ query: 'art', cursor: null, limit: 10 });
  // The fresh subscription has not answered yet: the old pages stay up and the pull indicator stays engaged.
  mockResults = {};
  await act(() => finish());
  expect(Object.values(mockRequests).map((request) => request.args.cursor)).toEqual([null]);
  expect(view.result.current.items.map((profile) => profile.name)).toEqual(['alex', 'bea']);
  expect(view.result.current.refreshing).toBe(true);
  mockResults = { first: page('cleo', null, true) };
  await view.rerender(undefined);
  expect(view.result.current.refreshing).toBe(false);
  expect(view.result.current.loading).toBe(false);
  expect(view.result.current.items.map((profile) => profile.name)).toEqual(['cleo']);
});

it('drops held pages when the fresh subscription answers with an error', async () => {
  mockResults.first = page('alex', null, true);
  mockHttpQuery.mockResolvedValue(undefined);
  const view = await renderHook(() => useCursorPages(api.profiles.search, { query: 'art' }, 'account-a', select, identify));
  mockResults.first = new ConvexError('Feed unavailable');
  await act(() => view.result.current.refresh());
  expect(view.result.current.items).toEqual([]);
  expect(view.result.current.refreshing).toBe(false);
  expect(view.result.current.error).toBeInstanceOf(ConvexError);
});

it('does not hold a failed read on screen while its retry is in flight', async () => {
  mockResults.first = new ConvexError('Feed unavailable');
  mockHttpQuery.mockImplementation(() => new Promise(() => {}));
  const view = await renderHook(() => useCursorPages(api.profiles.search, { query: 'art' }, 'account-a', select, identify));
  expect(view.result.current.error).toBeDefined();
  await act(() => view.result.current.refresh());
  expect(view.result.current.error).toBeUndefined();
  expect(view.result.current.items).toEqual([]);
  expect(view.result.current.loading).toBe(true);
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
  expect(reportError).not.toHaveBeenCalled();
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

it('keeps loaded rows visible while retrying a failed later page', async () => {
  mockResults = { first: page('alex', 'next'), next: new TypeError('Network request failed') };
  const view = await renderHook(() => useCursorPages(api.profiles.search, { query: 'art' }, 'account-a', select, identify));
  await act(() => view.result.current.loadMore());
  expect(view.result.current.items.map((profile) => profile.name)).toEqual(['alex']);
  expect(view.result.current.error).toBeDefined();
  mockHttpQuery.mockImplementation(() => new Promise(() => {}));
  await act(() => view.result.current.refresh());
  expect(view.result.current.items.map((profile) => profile.name)).toEqual(['alex']);
  expect(view.result.current.loading).toBe(true);
});

it('reports subscription failures with the query name and no private query arguments', async () => {
  const failure = new Error('Unexpected profile query failure');
  mockResults.first = failure;
  const view = await renderHook(() => useSocialQuery(api.profiles.getPublic, { profileId: 'private-profile-id' as never }, 'private-account-scope'));
  expect(view.result.current.error).toBe(failure);
  expect(reportError).toHaveBeenCalledWith(failure, 'social.query.profiles:getPublic');
  expect(reportError).toHaveBeenCalledTimes(1);
  await view.rerender(undefined);
  expect(reportError).toHaveBeenCalledTimes(1);
});

it('reports failed later pages without including the cursor or search text', async () => {
  const failure = new Error('Unexpected page failure');
  mockResults = { first: page('alex', 'private-cursor'), 'private-cursor': failure };
  const view = await renderHook(() => useCursorPages(api.profiles.search, { query: 'private search text' }, 'private-scope', select, identify));
  await act(() => view.result.current.loadMore());
  expect(view.result.current.error).toBe(failure);
  expect(reportError).toHaveBeenCalledWith(failure, 'social.query.profiles:search');
});
