import { renderHook } from "@testing-library/react-native";
import { setBadgeCountAsync } from "expo-notifications";

import { countBadge, useWatchUnseenNotifications } from "./unseen-notifications";
import type { SocialSession } from "./use-social-session";

const mockLoadMore = jest.fn();
let mockItems: { id: string; kind: string; postId?: string }[];
let mockCanLoadMore: boolean;
let mockSession: Pick<SocialSession, "status" | "key">;
const mockArgs = jest.fn();
jest.mock("./use-social-session", () => ({ useSocialSession: () => mockSession }));
jest.mock("./use-social-query", () => ({
  useCursorPages: (_query: unknown, args: unknown) => {
    mockArgs(args);
    return { items: mockItems, canLoadMore: mockCanLoadMore, loadMore: mockLoadMore };
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockItems = [];
  mockCanLoadMore = true;
  mockSession = { status: "ready", key: "account-a" };
});

it("continues through hidden pages, counts likes on one visit once, and badges the app icon", async () => {
  const view = await renderHook(() => useWatchUnseenNotifications());
  expect(mockLoadMore).toHaveBeenCalledTimes(1);
  mockItems = [{ id: "like-a", kind: "visitLike", postId: "visit-a" }];
  await view.rerender({});
  expect(view.result.current).toBe(1);
  mockItems = [
    ...mockItems,
    { id: "like-b", kind: "visitLike", postId: "visit-a" },
    { id: "request", kind: "friendRequest" },
  ];
  mockCanLoadMore = false;
  await view.rerender({});
  expect(view.result.current).toBe(2);
  expect(setBadgeCountAsync).toHaveBeenLastCalledWith(2);
});

it("stops loading once the count passes the badge cap", async () => {
  mockItems = Array.from({ length: 100 }, (_, index) => ({ id: String(index), kind: "visitComment" }));
  const view = await renderHook(() => useWatchUnseenNotifications());
  expect(view.result.current).toBe(100);
  expect(countBadge(view.result.current)).toBe("99+");
  expect(mockLoadMore).not.toHaveBeenCalled();
});

it("skips the query and clears the app icon badge without a profile", async () => {
  mockSession = { status: "signed-out", key: "guest" };
  mockCanLoadMore = false;
  const view = await renderHook(() => useWatchUnseenNotifications());
  expect(mockArgs).toHaveBeenLastCalledWith("skip");
  expect(view.result.current).toBe(0);
  expect(countBadge(view.result.current)).toBeUndefined();
  expect(setBadgeCountAsync).toHaveBeenLastCalledWith(0);
});
