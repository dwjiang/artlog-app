import { act, renderHook } from "@testing-library/react-native";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";

import { switchOwner } from "@/lib/account/owner-store";
import { reportError } from "@/lib/observability";

import { api } from "../../../convex/_generated/api";
import type { PublicProfile } from "./types";
import { useBatchedSocialQuery, useCursorPages, useSocialQuery } from "./use-social-query";

jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));
let mockResults: Record<string, unknown>;
let mockBatchResults: unknown[] | undefined;
let mockRequests: Record<string, { query: unknown; args: { cursor?: string | null } }>;
const mockHttpQuery = jest.fn();
const mockClient = jest.fn();
jest.mock("@convex-dev/auth/react", () => ({ useAuthToken: () => "token-a" }));
jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));
jest.mock("convex/browser", () => ({
  ConvexHttpClient: function (url: string, options: object) {
    mockClient(url, options);
    return { query: mockHttpQuery };
  },
}));
jest.mock("convex/react", () => ({
  useQueries: (requests: typeof mockRequests) => {
    mockRequests = requests;
    return Object.fromEntries(
      Object.entries(requests).map(([key, request], index) => [
        key,
        mockBatchResults ? mockBatchResults[index] : mockResults[request.args.cursor ?? "first"],
      ]),
    );
  },
}));
const identify = (profile: PublicProfile) => profile.profileId;
const select = (result: { page: PublicProfile[]; cursor: string | null; isDone: boolean }) => result;
const page = (name: string, cursor: string | null, isDone = false) => ({
  page: [{ profileId: name, name, username: name, publishedWallCount: 0 }],
  cursor,
  isDone,
});
beforeEach(() => {
  jest.clearAllMocks();
  mockResults = {};
  mockBatchResults = undefined;
  mockRequests = {};
});

it("waits for every batch, retains null results, and clears old batches when the selection changes", async () => {
  mockBatchResults = [null, undefined];
  const args = [{ profileId: "alex" as never }, { profileId: "bea" as never }];
  const view = await renderHook(
    ({ selected }: { selected: typeof args }) => useBatchedSocialQuery(api.profiles.getPublic, selected, "account-a"),
    { initialProps: { selected: args } },
  );
  expect(view.result.current.loading).toBe(true);
  expect(view.result.current.data).toBeUndefined();
  mockBatchResults = [null, { name: "Bea" }];
  await view.rerender({ selected: args });
  expect(view.result.current.data).toEqual([null, { name: "Bea" }]);
  mockBatchResults = [undefined];
  await view.rerender({ selected: [{ profileId: "cleo" as never }] });
  expect(view.result.current.data).toBeUndefined();
  await view.rerender({ selected: [] });
  expect(view.result.current.data).toEqual([]);
  expect(view.result.current.loading).toBe(false);
});

it("retries each failed batch and restores live results after the retry", async () => {
  const failure = new Error("Batch failed");
  mockBatchResults = [{ name: "Alex" }, failure];
  mockHttpQuery.mockResolvedValue(undefined);
  const args = [{ profileId: "alex" as never }, { profileId: "bea" as never }];
  const view = await renderHook(() => useBatchedSocialQuery(api.profiles.getPublic, args, "account-a"));
  expect(view.result.current.error).toBe(failure);
  expect(view.result.current.data).toBeUndefined();
  await act(() => view.result.current.refresh());
  expect(mockHttpQuery.mock.calls.map((call) => call[1])).toEqual(args);
  mockBatchResults = [{ name: "Alex" }, { name: "Bea" }];
  await view.rerender(undefined);
  expect(view.result.current.error).toBeUndefined();
  expect(view.result.current.data).toEqual(mockBatchResults);
});

it("gates requests and clears content when the account changes or becomes unavailable", async () => {
  mockResults.first = page("alex", "next");
  const view = await renderHook(
    ({ scope, enabled }: { scope: string; enabled: boolean }) =>
      useCursorPages(api.profiles.search, enabled ? { query: "alex" } : "skip", scope, select, identify),
    { initialProps: { scope: "account-a", enabled: true } },
  );
  expect(view.result.current.items[0].name).toBe("alex");
  await act(() => view.result.current.loadMore());
  expect(Object.values(mockRequests).map((request) => request.args.cursor)).toEqual([null, "next"]);
  mockResults = {};
  await view.rerender({ scope: "account-b", enabled: true });
  expect(view.result.current.items).toEqual([]);
  expect(view.result.current.loading).toBe(true);
  expect(view.result.current.refreshing).toBe(false);
  expect(Object.values(mockRequests).map((request) => request.args.cursor)).toEqual([null]);
  await view.rerender({ scope: "account-b", enabled: false });
  expect(mockRequests).toEqual({});
  expect(view.result.current.items).toEqual([]);
});

it("keeps delivered pages on screen through a pull-to-refresh, then restarts from the first page", async () => {
  mockResults = { first: page("alex", "next"), next: page("bea", null, true) };
  const view = await renderHook(() =>
    useCursorPages(api.profiles.search, { query: "art" }, "account-a", select, identify),
  );
  await act(() => view.result.current.loadMore());
  expect(view.result.current.items.map((profile) => profile.name)).toEqual(["alex", "bea"]);
  let finish!: () => void;
  mockHttpQuery.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await act(() => view.result.current.refresh());
  expect(view.result.current.items.map((profile) => profile.name)).toEqual(["alex", "bea"]);
  expect(view.result.current.first).toEqual(page("alex", "next"));
  expect(view.result.current.loading).toBe(true);
  expect(view.result.current.refreshing).toBe(true);
  expect(view.result.current.canLoadMore).toBe(false);
  expect(mockRequests).toEqual({});
  expect(getFunctionName(mockHttpQuery.mock.calls[0][0])).toBe("profiles:search");
  expect(mockHttpQuery.mock.calls[0][1]).toEqual({
    query: "art",
    cursor: null,
    limit: 10,
  });
  // The fresh subscription has not answered yet: the old pages stay up and the pull indicator stays engaged.
  mockResults = {};
  await act(() => finish());
  expect(Object.values(mockRequests).map((request) => request.args.cursor)).toEqual([null]);
  expect(view.result.current.items.map((profile) => profile.name)).toEqual(["alex", "bea"]);
  expect(view.result.current.refreshing).toBe(true);
  mockResults = { first: page("cleo", null, true) };
  await view.rerender(undefined);
  expect(view.result.current.refreshing).toBe(false);
  expect(view.result.current.loading).toBe(false);
  expect(view.result.current.items.map((profile) => profile.name)).toEqual(["cleo"]);
});

it("drops held pages when the fresh subscription answers with an error", async () => {
  mockResults.first = page("alex", null, true);
  mockHttpQuery.mockResolvedValue(undefined);
  const view = await renderHook(() =>
    useCursorPages(api.profiles.search, { query: "art" }, "account-a", select, identify),
  );
  mockResults.first = new ConvexError("Feed unavailable");
  await act(() => view.result.current.refresh());
  expect(view.result.current.items).toEqual([]);
  expect(view.result.current.refreshing).toBe(false);
  expect(view.result.current.error).toBeInstanceOf(ConvexError);
});

it("does not hold a failed read on screen while its retry is in flight", async () => {
  mockResults.first = new ConvexError("Feed unavailable");
  mockHttpQuery.mockImplementation(() => new Promise(() => {}));
  const view = await renderHook(() =>
    useCursorPages(api.profiles.search, { query: "art" }, "account-a", select, identify),
  );
  expect(view.result.current.error).toBeDefined();
  await act(() => view.result.current.refresh());
  expect(view.result.current.error).toBeUndefined();
  expect(view.result.current.items).toEqual([]);
  expect(view.result.current.loading).toBe(true);
});

it("drops dependent subscriptions when reactive pagination cursors change", async () => {
  mockResults = { first: page("alex", "old"), old: page("stale", null, true) };
  const view = await renderHook(() =>
    useCursorPages(api.profiles.search, { query: "art" }, "account-a", select, identify),
  );
  await act(() => view.result.current.loadMore());
  mockResults.first = page("new", "new-cursor");
  await view.rerender({});
  expect(view.result.current.items.map((item) => item.name)).toEqual(["new"]);
  expect(Object.values(mockRequests).map((request) => request.args.cursor)).toEqual([null]);
});

it("catches query errors and suppresses inaccessible data", async () => {
  mockResults.first = new ConvexError({ code: "not_found" });
  const { result } = await renderHook(() =>
    useSocialQuery(api.sharedVisits.getArtwork, { postId: "post", itemId: "item" as never }, "account-a"),
  );
  expect(result.current.data).toBeUndefined();
  expect(result.current.error).toBeInstanceOf(ConvexError);
});

it("ignores a stale refresh failure after changing the query scope", async () => {
  let reject!: (error: Error) => void;
  mockHttpQuery.mockImplementation(
    () =>
      new Promise((_resolve, failure) => {
        reject = failure;
      }),
  );
  const view = await renderHook(
    ({ scope }: { scope: string }) => useSocialQuery(api.profiles.getPublic, { profileId: scope as never }, scope),
    { initialProps: { scope: "old" } },
  );
  await act(() => view.result.current.refresh());
  await view.rerender({ scope: "new" });
  await act(() => reject(new Error("Old request failed")));
  expect(view.result.current.error).toBeUndefined();
  expect(reportError).not.toHaveBeenCalled();
});

it("finishes refreshing when journal sync restores the same account's scope", async () => {
  switchOwner("account:a");
  mockResults.first = page("alex", null, true).page[0];
  let finish!: () => void;
  mockHttpQuery.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const view = await renderHook(() =>
    useSocialQuery(api.profiles.getPublic, { profileId: "alex" as never }, "account-a"),
  );
  await act(() => view.result.current.refresh());
  await act(() => switchOwner("account:a", "scope-a"));
  await act(() => finish());
  expect(view.result.current.refreshing).toBe(false);
  expect(view.result.current.data).toMatchObject({ name: "alex" });
});

it("keeps a delivered result on screen through a pull-to-refresh until the fresh subscription answers", async () => {
  const alex = page("alex", null, true).page[0];
  mockResults.first = alex;
  let finish!: () => void;
  mockHttpQuery.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const view = await renderHook(() =>
    useSocialQuery(api.profiles.getPublic, { profileId: "alex" as never }, "account-a"),
  );
  expect(view.result.current.refreshing).toBe(false);
  await act(() => view.result.current.refresh());
  expect(mockRequests).toEqual({});
  expect(view.result.current.data).toEqual(alex);
  expect(view.result.current.refreshing).toBe(true);
  mockResults = {};
  await act(() => finish());
  expect(Object.keys(mockRequests)).toHaveLength(1);
  expect(view.result.current.data).toEqual(alex);
  expect(view.result.current.refreshing).toBe(true);
  mockResults.first = { ...alex, name: "Alex Chen" };
  await view.rerender(undefined);
  expect(view.result.current.data).toMatchObject({ name: "Alex Chen" });
  expect(view.result.current.refreshing).toBe(false);
});

it("restores the live subscription when arguments return during a refresh", async () => {
  mockResults.first = page("alex", null, true).page[0];
  mockHttpQuery.mockImplementation(() => new Promise(() => {}));
  const view = await renderHook(
    ({ enabled }: { enabled: boolean }) =>
      useSocialQuery(api.profiles.getPublic, enabled ? { profileId: "alex" as never } : "skip", "account-a"),
    { initialProps: { enabled: true } },
  );
  await act(() => view.result.current.refresh());
  expect(view.result.current.loading).toBe(true);
  await view.rerender({ enabled: false });
  await view.rerender({ enabled: true });
  expect(view.result.current.loading).toBe(false);
  expect(view.result.current.data).toMatchObject({ name: "alex" });
  expect(Object.keys(mockRequests)).toHaveLength(1);
});

it("shows live data that arrives after a failed refresh instead of the stale error", async () => {
  mockResults.first = page("alex", null, true);
  mockHttpQuery.mockRejectedValue(new Error("Network request failed"));
  const view = await renderHook(() =>
    useCursorPages(api.profiles.search, { query: "art" }, "account-a", select, identify),
  );
  await act(() => view.result.current.refresh());
  expect(view.result.current.error).toBeUndefined();
  expect(view.result.current.items.map((profile) => profile.name)).toEqual(["alex"]);
  mockResults.first = null;
  const single = await renderHook(() =>
    useSocialQuery(api.profiles.getPublic, { profileId: "gone" as never }, "account-a"),
  );
  await act(() => single.result.current.refresh());
  expect(single.result.current.error).toBeUndefined();
  expect(single.result.current.data).toBeNull();
});

it("keeps loaded rows visible while retrying a failed later page", async () => {
  mockResults = {
    first: page("alex", "next"),
    next: new TypeError("Network request failed"),
  };
  const view = await renderHook(() =>
    useCursorPages(api.profiles.search, { query: "art" }, "account-a", select, identify),
  );
  await act(() => view.result.current.loadMore());
  expect(view.result.current.items.map((profile) => profile.name)).toEqual(["alex"]);
  expect(view.result.current.error).toBeDefined();
  mockHttpQuery.mockImplementation(() => new Promise(() => {}));
  await act(() => view.result.current.refresh());
  expect(view.result.current.items.map((profile) => profile.name)).toEqual(["alex"]);
  expect(view.result.current.loading).toBe(true);
});

it("reports subscription failures with the query name and no private query arguments", async () => {
  const failure = new Error("Unexpected profile query failure");
  mockResults.first = failure;
  const view = await renderHook(() =>
    useSocialQuery(api.profiles.getPublic, { profileId: "private-profile-id" as never }, "private-account-scope"),
  );
  expect(view.result.current.error).toBe(failure);
  expect(reportError).toHaveBeenCalledWith(failure, "social.query.profiles:getPublic");
  expect(reportError).toHaveBeenCalledTimes(1);
  await view.rerender(undefined);
  expect(reportError).toHaveBeenCalledTimes(1);
});

it("reports failed later pages without including the cursor or search text", async () => {
  const failure = new Error("Unexpected page failure");
  mockResults = {
    first: page("alex", "private-cursor"),
    "private-cursor": failure,
  };
  const view = await renderHook(() =>
    useCursorPages(api.profiles.search, { query: "private search text" }, "private-scope", select, identify),
  );
  await act(() => view.result.current.loadMore());
  expect(view.result.current.error).toBe(failure);
  expect(reportError).toHaveBeenCalledWith(failure, "social.query.profiles:search");
});

it("reports a failed read started before the session allowed it only once it is allowed", async () => {
  const failure = new ConvexError({ code: "device_not_registered" });
  mockResults.first = failure;
  const view = await renderHook(
    ({ report }: { report: boolean }) =>
      useCursorPages(api.profiles.search, { query: "alex" }, "account-a", select, identify, { report }),
    { initialProps: { report: false } },
  );
  expect(view.result.current.error).toBe(failure);
  expect(reportError).not.toHaveBeenCalled();
  await view.rerender({ report: true });
  expect(reportError).toHaveBeenCalledWith(failure, "social.query.profiles:search");
});
