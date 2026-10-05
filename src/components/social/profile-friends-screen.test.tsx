import { render, screen } from "@testing-library/react-native";
import { getFunctionName as mockGetFunctionName } from "convex/server";

import type { BrowsedProfile } from "@/lib/social/types";

import { ProfileFriendsScreen } from "./profile-friends-screen";

jest.mock("convex/react", () => ({
  ...jest.requireActual("convex/react"),
  useMutation: () => jest.fn(),
}));
jest.mock("expo-router", () => {
  const { Text } = jest.requireActual("react-native");
  return {
    // The title renders inline so tests can read it.
    Stack: { Screen: ({ options }: { options: { title: string } }) => <Text>{options.title}</Text> },
    router: { push: jest.fn() },
    useRouter: () => ({ push: jest.fn() }),
  };
});
jest.mock("@/lib/social/use-social-session", () => ({
  useSocialSession: () => ({ key: "a", status: "ready", profileId: "viewer", offline: false }),
}));
let mockFriends: BrowsedProfile[] | null | undefined;
jest.mock("@/lib/social/use-social-query", () => ({
  useSocialQuery: (query: Parameters<typeof mockGetFunctionName>[0]) => ({
    data: mockGetFunctionName(query) === "profiles:friends" ? mockFriends : { name: "Jamie Chen" },
    loading: mockFriends === undefined,
    refresh: jest.fn(),
  }),
}));

const person = (name: string, state?: "accepted" | "none"): BrowsedProfile => ({
  profileId: name.toLowerCase() as never,
  username: name.toLowerCase(),
  name,
  avatar: "vermeer",
  publishedWallCount: 0,
  ...(state ? { relationship: { state, revision: 1, requesterId: null, blocked: false, blockRevision: 0 } } : {}),
});
const rows = () =>
  screen
    .getAllByRole("button", { name: /^View .*’s profile$/ })
    .map((row) => row.props.accessibilityLabel.replace(/^View (.*)’s profile$/, "$1"));

it("lists someone’s friends under their name: you, then the ones you share, then the rest", async () => {
  mockFriends = [person("Ana", "none"), person("Ben", "accepted"), person("Viewer"), person("Zoe", "accepted")];
  await render(<ProfileFriendsScreen profileId="jamie" />);
  expect(screen.getByText("Jamie’s Friends")).toBeOnTheScreen();
  expect(rows()).toEqual(["Viewer", "Ben", "Zoe", "Ana"]);
  expect(screen.getByText("You")).toBeOnTheScreen();
  expect(screen.getAllByText("Friends")).toHaveLength(2);
  expect(screen.getAllByRole("button", { name: "Add" })).toHaveLength(1);
});

it.each([
  ["No friends yet.", []],
  ["Friends unavailable.", null],
])("says “%s” for an empty or unavailable list", async (message, friends) => {
  mockFriends = friends;
  await render(<ProfileFriendsScreen profileId="jamie" />);
  expect(screen.getByText(message)).toBeOnTheScreen();
});

it("holds a loading list while friends load", async () => {
  mockFriends = undefined;
  await render(<ProfileFriendsScreen profileId="jamie" />);
  expect(screen.getByRole("progressbar", { name: "Opening friends…" })).toBeOnTheScreen();
});
