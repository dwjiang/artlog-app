import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { getFunctionName as mockGetFunctionName } from "convex/server";
import { ActionSheetIOS, type HostInstance, ScrollView, Text, type TextInstance } from "react-native";

import { lastRefreshControl } from "@/components/pull-to-refresh.testing";
import { scrollViewHolding } from "@/components/scroll-view.testing";
import { Gallery } from "@/constants/theme";
import type { BrowsedProfile, InCommon, SharedVisit } from "@/lib/social/types";

import { ProfileScreen } from "./profile-screen";

const mockPages = jest.fn();
const mockQueryRefresh = jest.fn();
const mockVisitsRefresh = jest.fn();
jest.mock("convex/react", () => ({
  ...jest.requireActual("convex/react"),
  useMutation: () => jest.fn(),
}));
let mockRelationship: { state: string; blocked: boolean; blockRevision?: number } = {
  state: "none",
  blocked: false,
};
const mockPerson = {
  profileId: "friend" as never,
  username: "friend",
  name: "Jamie Chen",
  bio: "Chasing Rothkos.",
  avatar: "vermeer" as const,
  publishedWallCount: 0,
};
let mockProfile: typeof mockPerson | undefined;
let mockWall: { color: string; items: never[] } | undefined;
const mockPush = jest.fn();
const mockSetOptions = jest.fn();
jest.mock("expo-router", () => ({
  Stack: jest.requireActual("@/components/stack-toolbar-mock").mockStack,
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useRouter: () => ({ push: mockPush }),
  useNavigation: () => ({ setOptions: mockSetOptions }),
}));
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 116, useIsFocused: () => true }));
jest.mock("@/components/collection/wall-gallery", () => ({ WallGallery: () => null }));
jest.mock("./friendship-controls", () => {
  const { Text } = jest.requireActual("react-native");
  return { FriendshipControls: () => <Text>Friendship controls</Text> };
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
        ? mockProfile
        : mockGetFunctionName(query) === "friendships:getState"
          ? mockRelationship
          : mockGetFunctionName(query) === "visitReactions:getSummary"
            ? { likeCount: 0, commentCount: 0, liked: false }
            : mockGetFunctionName(query) === "suggestions:inCommonWith"
              ? mockInCommon
              : mockGetFunctionName(query) === "profiles:friends"
                ? mockFriends
                : mockWall,
    refresh: () => mockQueryRefresh(mockGetFunctionName(query)),
  }),
  useCursorPages: (...args: unknown[]) => {
    mockPages(...args);
    return {
      items: mockVisits,
      done: mockVisitsDone,
      loading: mockVisitsLoading,
      canLoadMore: !mockVisitsDone && !mockVisitsLoading,
      refresh: mockVisitsRefresh,
    };
  },
}));
const mockBlock = jest.fn();
const mockUnblock = jest.fn();
jest.mock("@/lib/social/use-block", () => ({
  useBlock: () => ({ block: mockBlock, unblock: mockUnblock, pending: undefined }),
}));
let mockVisits: SharedVisit[] = [];
let mockVisitsDone = true;
let mockVisitsLoading = false;
let mockInCommon: InCommon = { artworks: [], museums: [] };
let mockFriends: BrowsedProfile[] | null = [];
const friendRow = (name: string, state?: "accepted" | "none"): BrowsedProfile => ({
  profileId: name.toLowerCase() as never,
  username: name.toLowerCase(),
  name,
  avatar: "vermeer",
  publishedWallCount: 0,
  ...(state ? { relationship: { state, revision: 1, requesterId: null, blocked: false, blockRevision: 0 } } : {}),
});
const visit: SharedVisit = {
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
  color: "#FCFCF9",
  companions: [],
  mentions: [],
  artworks: { page: [], cursor: null, isDone: true },
};
const filterChoices = () => {
  const filter = screen.queryByLabelText("Visibility");
  return filter
    ? within(filter)
        .getAllByRole("button")
        .map((choice) => choice.props.accessibilityLabel)
    : [];
};
beforeEach(() => {
  jest.clearAllMocks();
  mockRelationship = { state: "none", blocked: false };
  mockProfile = mockPerson;
  mockWall = { color: "#45524B", items: [] };
  mockVisits = [];
  mockVisitsDone = true;
  mockVisitsLoading = false;
  mockInCommon = { artworks: [], museums: [] };
  mockFriends = [];
});

it("requests authorized public visits for strangers", async () => {
  await render(<ProfileScreen profileId="friend" />);
  await fireEvent.press(screen.getByRole("button", { name: "Visits" }));
  expect(screen.getByText("No shared visits yet.")).toBeOnTheScreen();
  expect(mockPages.mock.calls.at(-1)[1]).toEqual({ profileId: "friend" });
});

it("filters your own visits by every visibility and keeps the full count", async () => {
  mockVisits = [visit];
  await render(<ProfileScreen profileId="owner" />);
  await fireEvent.press(screen.getByRole("button", { name: "Visits" }));
  expect(filterChoices()).toEqual(["All Visits", "Private", "Friends", "Public"]);
  mockVisits = [];
  await fireEvent.press(screen.getByRole("button", { name: "Private" }));
  expect(mockPages.mock.calls.at(-1)[1]).toEqual({ profileId: "owner", audience: "private" });
  expect(screen.getByText("No private visits.")).toBeOnTheScreen();
  expect(screen.getByLabelText("1 visit")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "All Visits" }));
  expect(mockPages.mock.calls.at(-1)[1]).toEqual({ profileId: "owner" });
});

it("offers a friend’s Friends and Public visits and no filter to strangers", async () => {
  mockVisits = [visit];
  await render(<ProfileScreen profileId="friend" />);
  await fireEvent.press(screen.getByRole("button", { name: "Visits" }));
  expect(filterChoices()).toEqual([]);
  mockRelationship = { state: "accepted", blocked: false };
  await render(<ProfileScreen profileId="friend" />);
  await fireEvent.press(screen.getByRole("button", { name: "Visits" }));
  expect(filterChoices()).toEqual(["All Visits", "Friends", "Public"]);
  await fireEvent.press(within(screen.getByLabelText("Visibility")).getByRole("button", { name: "Friends" }));
  expect(mockPages.mock.calls.at(-1)[1]).toEqual({ profileId: "friend", audience: "friends" });
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

it("draws the profile’s layout as ghosts until the profile arrives", async () => {
  mockProfile = undefined;
  const view = await render(<ProfileScreen profileId="friend" />);
  const scroll = scrollViewHolding(screen.getByRole("progressbar", { name: "Opening profile…" }));
  expect(scroll.props.scrollEnabled).toBe(false);
  for (const loading of ["Opening profile…", "Loading counts", "Loading profile actions…", "Opening wall…"]) {
    expect(screen.getByRole("progressbar", { name: loading })).toBeOnTheScreen();
  }
  expect(screen.queryByRole("button", { name: "Report Profile…" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Visits" }));
  expect(screen.getByRole("progressbar", { name: "Loading visits…" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Wall" }));
  mockProfile = mockPerson;
  await view.rerender(<ProfileScreen profileId="friend" />);
  expect(screen.getByRole("header", { name: "Jamie Chen" })).toBeOnTheScreen();
  expect(scroll.props.scrollEnabled).toBe(true);
  expect(screen.getByText("No artworks on this wall yet.")).toBeOnTheScreen();
  expect(screen.queryByRole("progressbar")).toBeNull();
});

it.each(["Wall", "Visits"])("keeps loaded profile content scrollable while %s loads", async (section) => {
  mockWall = undefined;
  mockVisitsLoading = true;
  mockVisitsDone = false;
  mockInCommon = {
    artworks: [
      {
        itemId: "lilies" as never,
        artwork: { title: "Water Lilies", artist: "Claude Monet", media: { kind: "placeholder", width: 1, height: 1 } },
      },
    ],
    museums: [],
  };
  await render(<ProfileScreen profileId="friend" />);
  await fireEvent.press(screen.getByRole("button", { name: section }));
  expect(
    screen.getByRole("progressbar", { name: section === "Wall" ? "Opening wall…" : "Loading visits…" }),
  ).toBeOnTheScreen();
  const artwork = screen.getByRole("button", { name: "Water Lilies, Claude Monet" });
  expect(scrollViewHolding(artwork).props.scrollEnabled).toBe(true);
  await fireEvent.press(artwork);
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/artwork", params: { kind: "wall", itemId: "lilies" } });
});

it("links the tags in a bio to their pages", async () => {
  mockProfile = { ...mockPerson, bio: "Chasing #Rothko rooms." };
  await render(<ProfileScreen profileId="friend" />);
  await fireEvent.press(screen.getByRole("link", { name: "#Rothko" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/tag/[tag]", params: { tag: "rothko" } });
});

it("shows an empty wall without sending the viewer back to friends", async () => {
  await render(<ProfileScreen profileId="friend" />);
  expect(screen.getByText("No artworks on this wall yet.")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Back to friends" })).not.toBeOnTheScreen();
});

it("keeps loaded counts and friend navigation available between visit pages", async () => {
  mockRelationship = { state: "accepted", blocked: false };
  mockFriends = [friendRow("Ana Ruiz", "none")];
  mockVisitsDone = false;
  mockVisitsLoading = true;
  const view = await render(<ProfileScreen profileId="friend" />);
  expect(screen.getByRole("progressbar", { name: "Loading counts" })).toBeOnTheScreen();

  mockVisitsLoading = false;
  mockVisits = Array.from({ length: 10 }, (_, index) => ({ ...visit, postId: `post-${index}` as never }));
  await view.rerender(<ProfileScreen profileId="friend" />);
  expect(screen.queryByRole("progressbar", { name: "Loading counts" })).toBeNull();
  expect(screen.getByLabelText("0 artworks")).toBeOnTheScreen();
  expect(screen.queryByLabelText("10 visits")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "1 friend" }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/profile-friends", params: { profileId: "friend" } });

  await fireEvent.press(screen.getByRole("button", { name: "Visits" }));
  expect(screen.getByRole("button", { name: "More visits" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "1 friend" })).toBeOnTheScreen();

  mockVisits = [...mockVisits, visit];
  mockVisitsDone = true;
  await view.rerender(<ProfileScreen profileId="friend" />);
  expect(screen.getByLabelText("11 visits")).toBeOnTheScreen();
});

it("keeps the full header when switching between Wall and Visits", async () => {
  await render(<ProfileScreen profileId="friend" />);
  const header = () => [
    screen.getByRole("header", { name: "Jamie Chen" }),
    screen.getAllByText("Chasing Rothkos.")[0],
    screen.getByText("artworks"),
    screen.getByText("visits"),
    screen.getByText("Friendship controls"),
  ];
  header().forEach((element) => expect(element).toBeOnTheScreen());
  await fireEvent.press(screen.getByRole("button", { name: "Visits" }));
  header().forEach((element) => expect(element).toBeOnTheScreen());
  await fireEvent.press(screen.getByRole("button", { name: "Wall" }));
  header().forEach((element) => expect(element).toBeOnTheScreen());
});

it("puts Share and Edit in your own profile’s bar, with nothing to report", async () => {
  await render(<ProfileScreen profileId="owner" />);
  await fireEvent.press(screen.getByRole("button", { name: "Share Profile" }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/share-profile", params: { profileId: "owner" } });
  await fireEvent.press(screen.getByRole("button", { name: "Edit" }));
  expect(mockPush).toHaveBeenLastCalledWith("/edit-profile");
  expect(screen.queryByRole("button", { name: "Edit Profile" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Report Profile…" })).toBeNull();
});

it("shares and reports someone else’s profile from the header menu, not the body", async () => {
  await render(<ProfileScreen profileId="friend" />);
  expect(screen.queryByRole("button", { name: "Share Profile" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Share Profile…" }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/share-profile", params: { profileId: "friend" } });
  await fireEvent.press(screen.getByRole("button", { name: "Report Profile…" }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/report", params: { kind: "profile", id: "friend" } });
});

it("names the person in the bar only while their name is scrolled under it", async () => {
  const nativeScroll = {} as HostInstance;
  const scrollRef = jest.spyOn(ScrollView.prototype, "getNativeScrollRef").mockReturnValue(nativeScroll);
  const measure = jest
    .spyOn(Text.prototype as TextInstance, "measureLayout")
    .mockImplementation((relativeTo, onSuccess) => {
      if (relativeTo === nativeScroll) onSuccess(20, 130, 362, 39);
    });
  try {
    await render(<ProfileScreen profileId="friend" />);
    const name = screen.getByRole("header", { name: "Jamie Chen" });
    await fireEvent(name, "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 362, height: 39 } } });
    const scrollTo = (y: number) => fireEvent.scroll(name, { nativeEvent: { contentOffset: { x: 0, y } } });
    await scrollTo(-116);
    await scrollTo(52);
    expect(mockSetOptions).toHaveBeenCalledWith({ title: "Jamie Chen" });
    expect(mockSetOptions).not.toHaveBeenCalledWith({ headerTitleStyle: expect.anything() });
    await scrollTo(53);
    expect(mockSetOptions).toHaveBeenLastCalledWith({ headerTitleStyle: { color: Gallery.ink } });
    await scrollTo(-116);
    expect(mockSetOptions).toHaveBeenLastCalledWith({ headerTitleStyle: { color: "transparent" } });
  } finally {
    scrollRef.mockRestore();
    measure.mockRestore();
  }
});

it("blocks from the header menu, then hides the wall, visits, and In common until unblocked", async () => {
  mockRelationship = { state: "accepted", blocked: false };
  mockInCommon = { artworks: [], museums: [{ venueId: "museum" as never, name: "Museum of Modern Art" }] };
  const view = await render(<ProfileScreen profileId="friend" />);
  expect(screen.getByText("In common")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Block…" }));
  expect(mockBlock).toHaveBeenCalledWith(expect.objectContaining({ profileId: "friend", name: "Jamie Chen" }));
  mockRelationship = { state: "none", blocked: true, blockRevision: 3 };
  await view.rerender(<ProfileScreen profileId="friend" />);
  expect(screen.getByText("You blocked Jamie Chen.")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Jamie Chen" })).toBeOnTheScreen();
  for (const hidden of ["No artworks on this wall yet.", "In common", "Museum of Modern Art"]) {
    expect(screen.queryByText(hidden)).toBeNull();
  }
  expect(screen.queryByRole("button", { name: "Visits" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Block…" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Unblock…" }));
  expect(mockUnblock).toHaveBeenCalledWith(expect.objectContaining({ profileId: "friend" }), 3);
});

it("uses the same shared visit card as Home", async () => {
  mockVisits = [visit];
  await render(<ProfileScreen profileId="friend" />);
  await fireEvent.press(screen.getByRole("button", { name: "Visits" }));
  expect(screen.getByText("Museum of Modern Art · New York")).toBeOnTheScreen();
  expect(screen.getByLabelText("Sep 12, 2026")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "View Jamie Chen’s profile" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "More options" })).toBeOnTheScreen();
});

it("offers Block in a visit card’s menu after Report", async () => {
  mockVisits = [visit];
  const sheet = jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementation(() => {});
  await render(<ProfileScreen profileId="friend" />);
  await fireEvent.press(screen.getByRole("button", { name: "Visits" }));
  await fireEvent.press(screen.getByRole("button", { name: "More options" }));
  const [options, choose] = sheet.mock.calls[0];
  expect(options).toMatchObject({
    options: ["View Jamie Chen’s Profile", "Report Visit", "Block Jamie Chen", "Cancel"],
    destructiveButtonIndex: 2,
  });
  choose(2);
  expect(mockBlock).toHaveBeenCalledWith(mockPerson);
  sheet.mockRestore();
});

it("refreshes the profile and the open section when pulled", async () => {
  await render(<ProfileScreen profileId="friend" />);
  await act(() => lastRefreshControl().onRefresh?.());
  expect(mockQueryRefresh.mock.calls.flat()).toEqual(expect.arrayContaining(["profiles:getPublic", "walls:getPublic"]));
  expect(mockVisitsRefresh).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Visits" }));
  mockQueryRefresh.mockClear();
  await act(() => lastRefreshControl().onRefresh?.());
  expect(mockVisitsRefresh).toHaveBeenCalledTimes(1);
  expect(mockQueryRefresh.mock.calls.flat()).toContain("profiles:getPublic");
  expect(mockQueryRefresh.mock.calls.flat()).not.toContain("walls:getPublic");
});

it("shows the artworks and museums you have in common with someone else", async () => {
  mockInCommon = {
    artworks: [
      {
        itemId: "lilies" as never,
        artwork: { title: "Water Lilies", artist: "Claude Monet", media: { kind: "placeholder", width: 1, height: 1 } },
      },
    ],
    museums: [{ venueId: "moma" as never, name: "MoMA", city: "New York" }],
  };
  await render(<ProfileScreen profileId="friend" />);
  expect(screen.getByRole("header", { name: "In common" })).toBeOnTheScreen();
  expect(screen.getByText("You both visited · New York")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Water Lilies, Claude Monet" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/artwork", params: { kind: "wall", itemId: "lilies" } });
});

it("leaves In common out when nothing is shared", async () => {
  await render(<ProfileScreen profileId="friend" />);
  expect(screen.queryByText("In common")).toBeNull();
});

it("counts someone’s friends, names the ones you share, and opens their friend list from either", async () => {
  mockFriends = [
    friendRow("Ana Ruiz", "accepted"),
    friendRow("Ben Ode", "accepted"),
    friendRow("Cy Tan", "none"),
    friendRow("Owner"),
  ];
  await render(<ProfileScreen profileId="friend" />);
  const friendList = { pathname: "/profile-friends", params: { profileId: "friend" } };
  await fireEvent.press(screen.getByRole("button", { name: "Friends with Ana and Ben" }));
  expect(mockPush).toHaveBeenLastCalledWith(friendList);
  mockPush.mockClear();
  await fireEvent.press(screen.getByRole("button", { name: "4 friends" }));
  expect(mockPush).toHaveBeenLastCalledWith(friendList);
});

it("opens your own friends from your profile’s count, with no shared-friends line", async () => {
  mockFriends = [friendRow("Ana Ruiz", "accepted")];
  await render(<ProfileScreen profileId="owner" />);
  expect(screen.queryByText(/^Friends with/)).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "1 friend" }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/people", params: { filter: "friends" } });
});

it("leaves friends out of the header when you can’t see them", async () => {
  mockFriends = null;
  await render(<ProfileScreen profileId="friend" />);
  expect(screen.getByLabelText("0 artworks")).toBeOnTheScreen();
  expect(screen.queryByLabelText(/friends?$/)).toBeNull();
});
