import { render, screen } from "@testing-library/react-native";

import type { SocialSession } from "@/lib/social/use-social-session";

import { NotificationsButton } from "./notifications-button";

const mockLoadMore = jest.fn();
let mockItems: { id: string; kind: string; postId?: string }[];
let mockCanLoadMore: boolean;
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/lib/social/use-social-query", () => ({
  useCursorPages: () => ({ items: mockItems, canLoadMore: mockCanLoadMore, loadMore: mockLoadMore }),
}));
const session = { status: "ready", key: "account-a" } as SocialSession;

beforeEach(() => {
  jest.clearAllMocks();
  mockItems = [];
  mockCanLoadMore = true;
});

it("continues through hidden pages and counts likes across pages only once", async () => {
  const view = await render(<NotificationsButton session={session} />);
  expect(mockLoadMore).toHaveBeenCalledTimes(1);
  mockItems = [{ id: "like-a", kind: "visitLike", postId: "visit-a" }];
  await view.rerender(<NotificationsButton session={session} />);
  expect(screen.getByRole("button", { name: "Notifications, 1 new" })).toBeOnTheScreen();
  mockItems = [
    ...mockItems,
    { id: "like-b", kind: "visitLike", postId: "visit-a" },
    { id: "request", kind: "friendRequest" },
  ];
  mockCanLoadMore = false;
  await view.rerender(<NotificationsButton session={session} />);
  expect(screen.getByRole("button", { name: "Notifications, 2 new" })).toBeOnTheScreen();
});

it("stops counting once the badge reaches 99+", async () => {
  mockItems = Array.from({ length: 100 }, (_, index) => ({ id: String(index), kind: "visitComment" }));
  await render(<NotificationsButton session={session} />);
  expect(screen.getByRole("button", { name: "Notifications, 99+ new" })).toBeOnTheScreen();
  expect(mockLoadMore).not.toHaveBeenCalled();
});
