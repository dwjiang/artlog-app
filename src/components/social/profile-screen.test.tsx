import { fireEvent, render, screen } from "@testing-library/react-native";
import { getFunctionName as mockGetFunctionName } from "convex/server";
import type { ReactNode } from "react";

import type { SharedVisit } from "@/lib/social/types";

import { ProfileScreen } from "./profile-screen";

const mockPages = jest.fn();
jest.mock("convex/react", () => ({
  ...jest.requireActual("convex/react"),
  useMutation: () => jest.fn(),
}));
let mockRelationship: { state: string; blocked: boolean } = {
  state: "none",
  blocked: false,
};
const mockPerson = {
  profileId: "friend" as never,
  username: "friend",
  name: "Jamie Chen",
  bio: "Chasing Rothkos.",
  publishedWallCount: 0,
};
jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("@/components/collection/wall-gallery", () => ({ WallGallery: () => null }));
jest.mock("./friendship-controls", () => {
  const { Text } = jest.requireActual("react-native");
  return {
    FriendshipControls: ({ trailing }: { trailing: ReactNode }) => (
      <>
        <Text>Friendship controls</Text>
        {trailing}
      </>
    ),
    ProfileActionRow: ({ actions, trailing }: { actions: ReactNode[]; trailing: ReactNode }) => (
      <>
        {actions}
        {trailing}
      </>
    ),
  };
});
jest.mock("@/lib/social/use-social-session", () => ({
  useSocialSession: () => ({
    key: "a",
    status: "ready",
    profileId: "owner",
    offline: false,
  }),
}));
jest.mock("@/lib/social/use-social-query", () => ({
  useSocialQuery: (query: Parameters<typeof mockGetFunctionName>[0]) => ({
    data:
      mockGetFunctionName(query) === "profiles:getPublic"
        ? mockPerson
        : mockGetFunctionName(query) === "friendships:getState"
          ? mockRelationship
          : mockGetFunctionName(query) === "visitReactions:getSummary"
            ? { likeCount: 0, commentCount: 0, liked: false }
            : { color: "#45524B", items: [] },
  }),
  useCursorPages: (...args: unknown[]) => {
    mockPages(...args);
    return { items: mockVisits, done: true, loading: false };
  },
}));
let mockVisits: SharedVisit[] = [];
beforeEach(() => {
  jest.clearAllMocks();
  mockRelationship = { state: "none", blocked: false };
  mockVisits = [];
});

it("requests authorized public visits for strangers", async () => {
  await render(<ProfileScreen profileId="friend" />);
  await fireEvent.press(screen.getByRole("button", { name: "Visits" }));
  expect(screen.getByText("No shared visits yet.")).toBeOnTheScreen();
  expect(mockPages.mock.calls.at(-1)[1]).toEqual({ profileId: "friend" });
});

it("requests only the selected friend’s shared visits and stops after a block", async () => {
  mockRelationship = { state: "accepted", blocked: false };
  const view = await render(<ProfileScreen profileId="friend" />);
  await fireEvent.press(screen.getByRole("button", { name: "Visits" }));
  expect(mockPages.mock.calls.at(-1)[1]).toEqual({ profileId: "friend" });
  expect(screen.getByText("No shared visits yet.")).toBeOnTheScreen();
  mockRelationship = { state: "accepted", blocked: true };
  await view.rerender(<ProfileScreen profileId="friend" />);
  expect(mockPages.mock.calls.at(-1)[1]).toBe("skip");
});

it("keeps the full header when switching between Wall and Visits", async () => {
  await render(<ProfileScreen profileId="friend" />);
  const header = () => [
    screen.getByRole("header", { name: "Jamie Chen" }),
    screen.getAllByText("Chasing Rothkos.")[0],
    screen.getByText("artworks"),
    screen.getByText("visits"),
    screen.getByText("Friendship controls"),
    screen.getByRole("button", { name: "Share profile" }),
  ];
  header().forEach((element) => expect(element).toBeOnTheScreen());
  await fireEvent.press(screen.getByRole("button", { name: "Visits" }));
  header().forEach((element) => expect(element).toBeOnTheScreen());
  await fireEvent.press(screen.getByRole("button", { name: "Wall" }));
  header().forEach((element) => expect(element).toBeOnTheScreen());
});

it("offers Share beside Edit profile on your own profile", async () => {
  await render(<ProfileScreen profileId="owner" />);
  expect(screen.getByRole("button", { name: "Edit profile" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Share profile" })).toBeOnTheScreen();
});

it("uses the same shared visit card as Home", async () => {
  mockVisits = [
    {
      audience: "public",
      postId: "post-a",
      author: mockPerson,
      publishedAt: 1,
      revision: 1,
      reflection: "",
      venue: {
        venueId: "museum" as never,
        name: "Museum of Modern Art",
        city: "New York",
      },
      visitedOn: "2026-09-12",
      artworks: { page: [], cursor: null, isDone: true },
    },
  ];
  await render(<ProfileScreen profileId="friend" />);
  await fireEvent.press(screen.getByRole("button", { name: "Visits" }));
  expect(screen.getByText("Museum of Modern Art · New York")).toBeOnTheScreen();
  expect(screen.getByLabelText("September 12, 2026")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "View visit" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "View Jamie Chen’s profile" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "More options" })).toBeOnTheScreen();
});
