import { act, renderHook } from "@testing-library/react-native";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";

import { switchOwner } from "@/lib/account/owner-store";

import { friendshipActions } from "./presentation";
import type { Relationship } from "./types";
import { useFriendship } from "./use-friendship";
import type { SocialSession } from "./use-social-session";

let mockRelationship: Relationship;
const mockMutation = jest.fn();
const mockOptions = jest.fn();
const mockRefresh = jest.fn();
const mockQueryArgs = jest.fn();
jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));
jest.mock("convex/browser", () => ({
  ConvexHttpClient: function (_url: string, options: object) {
    mockOptions(options);
    return { mutation: mockMutation };
  },
}));
jest.mock("./use-social-query", () => ({
  useSocialQuery: (_query: unknown, args: unknown) => {
    mockQueryArgs(args);
    return { data: mockRelationship, refresh: mockRefresh };
  },
}));
const session: SocialSession = {
  key: "scope-a",
  token: "token-a",
  profileId: "viewer" as never,
  status: "ready",
  offline: false,
  accountReady: true,
  error: undefined,
  refresh: jest.fn(),
};
const relationship = (patch: Partial<Relationship> = {}): Relationship => ({
  state: "none",
  revision: 0,
  requesterId: null,
  blocked: false,
  blockRevision: 0,
  ...patch,
});
beforeEach(() => {
  jest.clearAllMocks();
  switchOwner("account:a", "scope-a");
  mockRelationship = relationship();
});

it("requests and cancels using the server revision and the captured account token", async () => {
  mockMutation
    .mockResolvedValueOnce(
      relationship({
        state: "pending",
        revision: 1,
        requesterId: "viewer" as never,
      }),
    )
    .mockResolvedValueOnce(
      relationship({
        state: "none",
        revision: 2,
        requesterId: "viewer" as never,
      }),
    );
  const { result } = await renderHook(() => useFriendship("other" as never, session));
  await act(() => result.current.act("request"));
  expect(getFunctionName(mockMutation.mock.calls[0][0])).toBe("friendships:request");
  expect(mockMutation.mock.calls[0][1]).toEqual({
    profileId: "other",
    revision: 0,
  });
  expect(mockOptions).toHaveBeenCalledWith(expect.objectContaining({ auth: "token-a" }));
  expect(friendshipActions(result.current.state!, "viewer")).toEqual(["cancel"]);
  await act(() => result.current.act("cancel"));
  expect(mockMutation.mock.calls[1][1].revision).toBe(1);
  expect(friendshipActions(result.current.state!, "viewer")).toEqual(["request"]);
});

it.each(["accept", "decline", "remove"] as const)("applies a confirmed %s transition", async (action) => {
  mockRelationship = relationship({
    state: action === "remove" ? "accepted" : "pending",
    requesterId: "other" as never,
    revision: 4,
  });
  const next = action === "accept" ? "accepted" : "none";
  mockMutation.mockResolvedValue(relationship({ state: next, revision: 5, requesterId: "other" as never }));
  const { result } = await renderHook(() => useFriendship("other" as never, session));
  await act(() => result.current.act(action));
  expect(result.current.state?.state).toBe(next);
  expect(mockMutation.mock.calls[0][1].revision).toBe(4);
});

it("prevents double submission while a friendship request is in flight", async () => {
  let resolve!: (state: Relationship) => void;
  mockMutation.mockImplementation(
    () =>
      new Promise<Relationship>((done) => {
        resolve = done;
      }),
  );
  const { result } = await renderHook(() => useFriendship("other" as never, session));
  await act(() => {
    void result.current.act("request");
    void result.current.act("request");
  });
  expect(mockMutation).toHaveBeenCalledTimes(1);
  expect(result.current.busy).toBe(true);
  await act(() =>
    resolve(
      relationship({
        state: "pending",
        revision: 1,
        requesterId: "viewer" as never,
      }),
    ),
  );
  expect(result.current.busy).toBe(false);
});

it("refreshes conflicts without replaying the mutation", async () => {
  mockMutation.mockRejectedValue(new ConvexError({ code: "conflict" }));
  const { result } = await renderHook(() => useFriendship("other" as never, session));
  await act(() => result.current.act("request"));
  expect(mockMutation).toHaveBeenCalledTimes(1);
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(result.current.error).toContain("Review the updated options");
});

it("ignores an old account’s mutation response and refuses actions while offline", async () => {
  let resolve!: (state: Relationship) => void;
  mockMutation.mockImplementation(
    () =>
      new Promise<Relationship>((done) => {
        resolve = done;
      }),
  );
  const view = await renderHook(({ current }: { current: SocialSession }) => useFriendship("other" as never, current), {
    initialProps: { current: session },
  });
  await act(() => {
    void view.result.current.act("request");
  });
  await act(() => switchOwner("account:b", "scope-b"));
  await view.rerender({
    current: { ...session, key: "scope-b", offline: true, status: "offline" },
  });
  await act(() => resolve(relationship({ state: "accepted", revision: 1 })));
  expect(view.result.current.state).toBeUndefined();
  await act(() => view.result.current.act("request"));
  expect(mockMutation).toHaveBeenCalledTimes(1);
});

it("acts on a caller-held relationship without opening its own subscription and refreshes through the caller", async () => {
  const refresh = jest.fn();
  const source = {
    data: relationship({
      state: "pending",
      requesterId: "other" as never,
      revision: 2,
    }),
    refresh,
  };
  mockMutation.mockRejectedValueOnce(new ConvexError({ code: "conflict" }));
  const { result } = await renderHook(() => useFriendship("other" as never, session, source));
  expect(mockQueryArgs).toHaveBeenLastCalledWith("skip");
  expect(result.current.state).toEqual(source.data);
  await act(() => result.current.act("accept"));
  expect(mockMutation.mock.calls[0][1]).toEqual({
    profileId: "other",
    revision: 2,
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(mockRefresh).not.toHaveBeenCalled();
});
