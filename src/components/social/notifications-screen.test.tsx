import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";

import type { SocialSession } from "@/lib/social/use-social-session";

import { NotificationsScreen } from "./notifications-screen";

let mockSession: SocialSession;
let mockFocused: boolean;
let changeAppState: (state: AppStateStatus) => void;
let mockCanLoadMore: boolean;
const mockLoadMore = jest.fn();
let mockList: { data?: { seenAt: number; items: unknown[] }; error?: Error; loading: boolean; refresh: () => void };
const mockPush = jest.fn();
const mockMarkSeen = jest.fn(() => Promise.resolve(null));
jest.mock("@/lib/social/use-social-session", () => ({ useSocialSession: () => mockSession }));
jest.mock("@/lib/social/use-social-query", () => ({
  useCursorPages: () => ({
    ...mockList,
    first: mockList.data,
    items: mockList.data?.items ?? [],
    done: !mockCanLoadMore && !mockList.loading && !mockList.error,
    canLoadMore: mockCanLoadMore,
    loadMore: mockLoadMore,
  }),
}));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));
jest.mock("convex/react", () => ({ useMutation: () => mockMarkSeen }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  useIsFocused: () => mockFocused,
  useFocusEffect: (effect: () => (() => void) | undefined) => {
    const { useEffect } = jest.requireActual<typeof import("react")>("react");
    const focused = mockFocused;
    useEffect(() => (focused ? effect() : undefined), [effect, focused]);
  },
}));
jest.mock("./friendship-controls", () => ({
  CompactFriendshipControls: ({ relationship }: { relationship: { data: { state: string } } }) => {
    const { Text } = jest.requireActual("react-native");
    return <Text>{relationship.data.state === "accepted" ? "Friends" : "Accept"}</Text>;
  },
}));

const media = { kind: "placeholder", width: 1, height: 1 };
const person = (name: string) => ({ profileId: name, username: name.toLowerCase(), name, publishedWallCount: 0 });
const request = (state: "pending" | "accepted") => ({
  id: "request",
  kind: "friendRequest",
  createdAt: 1_500,
  actor: person("Lucía"),
  relationship: {
    state,
    revision: 1,
    requesterId: state === "pending" ? "Lucía" : null,
    blocked: false,
    blockRevision: 0,
  },
});
const items = [
  { id: "like-ben", kind: "visitLike", createdAt: 3_000, actor: person("Ben"), postId: "aic", venue: "AIC", media },
  {
    id: "comment",
    kind: "visitComment",
    createdAt: 2_500,
    actor: person("Hana"),
    postId: "aic",
    venue: "AIC",
    media,
    body: "The Seurat is huge.",
  },
  { id: "like-ana", kind: "visitLike", createdAt: 2_000, actor: person("Ana"), postId: "aic", venue: "AIC", media },
  request("pending"),
  { id: "accepted", kind: "friendAccepted", createdAt: 500, actor: person("Sam"), media },
  {
    id: "like-priya",
    kind: "visitLike",
    createdAt: 400,
    actor: person("Priya"),
    postId: "met",
    venue: "The Met",
    media,
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockFocused = true;
  mockCanLoadMore = false;
  AppState.currentState = "active";
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
    changeAppState = listener;
    return { remove: jest.fn() };
  });
  mockSession = {
    status: "ready",
    key: "account-a",
    token: "token-a",
    profileId: "profile-a" as never,
    offline: false,
    accountReady: true,
    refresh: jest.fn(),
    error: undefined,
  };
  mockList = { data: { seenAt: 1_000, items }, loading: false, refresh: jest.fn() };
});

it("splits unseen rows into New, collapses likes per visit, and marks the page seen", async () => {
  await render(<NotificationsScreen />);
  expect(screen.getByRole("header", { name: "New" })).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Earlier" })).toBeOnTheScreen();
  expect(
    screen.getByRole("button", { name: /^Ben \(@ben\) and Ana \(@ana\) liked your visit to AIC\./ }),
  ).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: /^Lucía \(@lucía\) sent you a friend request\./ })).toBeOnTheScreen();
  expect(screen.getByText("Accept")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: /^Sam \(@sam\) accepted your friend request\./ })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: /^Priya \(@priya\) liked your visit to The Met\./ })).toBeOnTheScreen();
  expect(mockMarkSeen).toHaveBeenCalledTimes(1);
  expect(mockMarkSeen).toHaveBeenCalledWith({ through: 3_000 });
});

it("leaves new arrivals unread behind another route and acknowledges them on return", async () => {
  mockList = { data: { seenAt: 3_000, items }, loading: false, refresh: jest.fn() };
  const view = await render(<NotificationsScreen />);
  await fireEvent.press(screen.getByRole("button", { name: /^Ben \(@ben\) and Ana \(@ana\) liked/ }));
  mockFocused = false;
  mockList = {
    data: { seenAt: 3_000, items: [{ ...items[1], id: "new-comment", createdAt: 4_000 }, ...items] },
    loading: false,
    refresh: jest.fn(),
  };
  await view.rerender(<NotificationsScreen />);
  expect(mockMarkSeen).not.toHaveBeenCalled();
  mockFocused = true;
  await view.rerender(<NotificationsScreen />);
  expect(mockMarkSeen).toHaveBeenCalledWith({ through: 4_000 });
});

it.each(["inactive", "background"] as const)("does not acknowledge arrivals while the app is %s", async (state) => {
  mockList = { data: { seenAt: 3_000, items }, loading: false, refresh: jest.fn() };
  const view = await render(<NotificationsScreen />);
  await act(() => changeAppState(state));
  mockList = {
    data: { seenAt: 3_000, items: [{ ...items[1], id: "new-comment", createdAt: 4_000 }, ...items] },
    loading: false,
    refresh: jest.fn(),
  };
  await view.rerender(<NotificationsScreen />);
  expect(mockMarkSeen).not.toHaveBeenCalled();
  await act(() => changeAppState("active"));
  expect(mockMarkSeen).toHaveBeenCalledWith({ through: 4_000 });
});

it("opens the visit for likes, its comments for a comment, and the profile for a friend", async () => {
  await render(<NotificationsScreen />);
  await fireEvent.press(screen.getByRole("button", { name: /^Ben \(@ben\) and Ana \(@ana\) liked/ }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/visit/[postId]", params: { postId: "aic" } });
  await fireEvent.press(
    screen.getByRole("button", { name: /^Hana \(@hana\) commented on your visit to AIC: “The Seurat is huge\.”/ }),
  );
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/visit/[postId]", params: { postId: "aic", comments: "1" } });
  await fireEvent.press(screen.getByRole("button", { name: /^Sam \(@sam\) accepted/ }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/profile/[profileId]", params: { profileId: "Sam" } });
});

it("says who added you to a visit and opens it", async () => {
  const added = {
    id: "added",
    kind: "visitCompanion" as const,
    createdAt: 3_500,
    actor: person("Maya"),
    postId: "met",
    venue: "The Met",
    media,
  };
  mockList = { data: { seenAt: 1_000, items: [added, ...items] }, loading: false, refresh: jest.fn() };
  await render(<NotificationsScreen />);

  await fireEvent.press(screen.getByRole("button", { name: /^Maya \(@maya\) added you to a visit to The Met\./ }));

  expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/visit/[postId]", params: { postId: "met" } });
});

it("rewrites an accepted request in place", async () => {
  mockList = { data: { seenAt: 2_000, items: [request("accepted")] }, loading: false, refresh: jest.fn() };
  await render(<NotificationsScreen />);
  expect(screen.getByRole("button", { name: /^You and Lucía \(@lucía\) are now friends\./ })).toBeOnTheScreen();
  expect(screen.queryByText("Friends")).toBeNull();
  expect(screen.queryByRole("header", { name: "New" })).toBeNull();
  expect(mockMarkSeen).not.toHaveBeenCalled();
});

it("says when there is nothing yet and offers to find friends", async () => {
  mockList = { data: { seenAt: 0, items: [] }, loading: false, refresh: jest.fn() };
  await render(<NotificationsScreen />);
  expect(screen.getByText("No notifications yet.")).toBeOnTheScreen();
  expect(screen.getByText("Find friends")).toBeOnTheScreen();
});

it("continues past an empty hidden page before showing the empty state", async () => {
  mockCanLoadMore = true;
  mockList = { data: { seenAt: 0, items: [] }, loading: false, refresh: jest.fn() };
  const view = await render(<NotificationsScreen />);
  expect(mockLoadMore).toHaveBeenCalled();
  expect(screen.queryByText("No notifications yet.")).toBeNull();
  mockCanLoadMore = false;
  mockList = { data: { seenAt: 0, items: [request("pending")] }, loading: false, refresh: jest.fn() };
  await view.rerender(<NotificationsScreen />);
  expect(screen.getByRole("button", { name: /^Lucía \(@lucía\) sent you a friend request/ })).toBeOnTheScreen();
});

it.each(["resume", "focus", "minute"] as const)("refreshes notification ages on %s", async (event) => {
  jest.useFakeTimers({ now: 3_000 });
  try {
    const view = await render(<NotificationsScreen />);
    expect(screen.getByRole("button", { name: /^Ben \(@ben\) and Ana \(@ana\) liked.*just now$/ })).toBeOnTheScreen();
    if (event === "resume") {
      await act(() => changeAppState("background"));
      jest.setSystemTime(183_000);
      await act(() => changeAppState("active"));
    } else if (event === "focus") {
      mockFocused = false;
      await view.rerender(<NotificationsScreen />);
      jest.setSystemTime(183_000);
      mockFocused = true;
      await view.rerender(<NotificationsScreen />);
    } else {
      await act(() => jest.advanceTimersByTime(180_000));
    }
    expect(
      screen.getByRole("button", { name: /^Ben \(@ben\) and Ana \(@ana\) liked.*3 minutes ago$/ }),
    ).toBeOnTheScreen();
    await view.unmount();
  } finally {
    jest.useRealTimers();
  }
});
