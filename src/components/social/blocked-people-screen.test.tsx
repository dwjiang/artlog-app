import { fireEvent, render, screen } from "@testing-library/react-native";

import type { PublicProfile } from "@/lib/social/types";
import type { SocialSession } from "@/lib/social/use-social-session";

import { BlockedPeopleScreen } from "./blocked-people-screen";

const mockUnblock = jest.fn();
const mockPageArgs = jest.fn();
let mockSession: Partial<SocialSession>;
let mockBlocked: (PublicProfile & { blockRevision: number })[];
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/lib/social/use-social-session", () => ({ useSocialSession: () => mockSession }));
jest.mock("@/lib/social/use-block", () => ({
  useBlock: () => ({ unblock: mockUnblock, pending: undefined }),
}));
jest.mock("@/lib/social/use-social-query", () => ({
  useCursorPages: (_query: unknown, args: unknown) => {
    mockPageArgs(args);
    return {
      items: mockBlocked,
      done: true,
      loading: false,
      canLoadMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    };
  },
}));

const jamie: PublicProfile & { blockRevision: number } = {
  profileId: "jamie" as never,
  username: "jamie",
  name: "Jamie Chen",
  avatar: "vermeer",
  publishedWallCount: 0,
  blockRevision: 3,
};
beforeEach(() => {
  jest.clearAllMocks();
  mockSession = { key: "a", status: "ready", profileId: "me" as never, offline: false };
  mockBlocked = [jamie];
});

it("lists blocked people with an Unblock button for each", async () => {
  await render(<BlockedPeopleScreen />);
  expect(screen.getByText("Jamie Chen")).toBeOnTheScreen();
  expect(screen.getByText("@jamie")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "View Jamie Chen’s profile" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Unblock Jamie Chen" }));
  expect(mockUnblock).toHaveBeenCalledWith(jamie, 3);
});

it("says when nobody is blocked", async () => {
  mockBlocked = [];
  await render(<BlockedPeopleScreen />);
  expect(screen.getByText("No blocked people.")).toBeOnTheScreen();
});

it("waits for a profile before reading the list", async () => {
  mockSession = { key: "a", status: "loading", offline: false };
  await render(<BlockedPeopleScreen />);
  expect(mockPageArgs).toHaveBeenCalledWith("skip");
  expect(screen.queryByText("No blocked people.")).toBeNull();
});
