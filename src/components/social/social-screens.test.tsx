import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";

import { lastRefreshControl } from "@/components/pull-to-refresh.testing";
import { Gallery } from "@/constants/theme";
import type { SharedVisit, Suggestion } from "@/lib/social/types";
import type { SocialSession } from "@/lib/social/use-social-session";

import { ArtworkScreen } from "./artwork-screen";
import { HomeScreen } from "./home-screen";
import { PeopleScreen } from "./people-screen";
import { VisitArtworks } from "./visit-card";
import { VisitScreen } from "./visit-screen";

const mockPush = jest.fn();
const mockDismissAll = jest.fn();
const mockRefresh = jest.fn();
const mockLoadMore = jest.fn();
const mockPages = jest.fn();
const mockQuery = jest.fn();
const mockSignIn = jest.fn();
jest.mock("@/lib/audio/use-listening");
jest.mock("convex/react", () => ({
  ...jest.requireActual("convex/react"),
  useMutation: () => jest.fn(),
}));
jest.mock("@/lib/account/use-account", () => ({
  useAccount: () => ({
    ready: true,
    available: true,
    busy: false,
    signInWithApple: mockSignIn,
  }),
}));

let mockSession: SocialSession;
jest.mock("@/lib/social/use-social-session", () => ({
  useSocialSession: () => mockSession,
}));
jest.mock("@/lib/social/use-social-query", () => ({
  useCursorPages: (...args: unknown[]) => mockPages(...args),
  useSocialQuery: (...args: unknown[]) => mockQuery(...args),
}));
const mockDismissSuggestion = jest.fn();
let mockSuggestions: { people: Suggestion[]; friendCount?: number };
jest.mock("@/lib/social/use-suggestions", () => ({
  useSuggestions: () => ({
    ...mockSuggestions,
    loading: false,
    error: undefined,
    refresh: mockRefresh,
    dismiss: mockDismissSuggestion,
  }),
}));
jest.mock("@/components/account/welcome-prompt", () => ({ WelcomePrompt: () => null }));
jest.mock("@/components/visits/now-card", () => ({ NowCard: () => null }));
jest.mock("@/components/visits/wrap-up-prompt", () => ({ WrapUpPrompt: () => null }));
jest.mock("@/db/repos/settings", () => ({
  getSetting: jest.fn(async () => undefined),
  setSetting: jest.fn(async () => {}),
}));
jest.mock("@/components/settings/account-section", () => ({
  AccountSection: () => {
    const { Text } = jest.requireActual("react-native");
    return <Text>Apple sign-in</Text>;
  },
}));
jest.mock("expo-image", () => ({
  Image: (props: object) => {
    const { View } = jest.requireActual("react-native");
    return <View accessibilityRole="image" {...props} />;
  },
}));
jest.mock("expo-network", () => ({
  useNetworkState: () => ({ isConnected: true, isInternetReachable: true }),
}));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: mockPush, navigate: mockPush }),
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    navigate: (...args: unknown[]) => mockPush(...args),
    dismissAll: () => mockDismissAll(),
  },
  Stack: jest.requireActual("@/components/stack-toolbar-mock").mockStack,
}));

const visit: SharedVisit = {
  audience: "public",
  postId: "post-a",
  author: {
    profileId: "alex" as never,
    name: "Alex Chen",
    username: "alex",
    avatar: "vermeer" as const,
    publishedWallCount: 0,
  },
  venue: { venueId: "museum" as never, name: "Museum of Modern Art" },
  visitedOn: "2026-09-12",
  reflection: "I kept coming back to the blue.",
  publishedAt: 1,
  revision: 1,
  artworks: {
    page: [
      {
        itemId: "art-a" as never,
        artwork: {
          title: "Blue afternoon",
          artist: "A. Artist",
          media: {
            kind: "catalog",
            width: 200,
            height: 400,
            url: "https://museum.example/art.jpg",
            sourceUrl: "https://museum.example/art",
            rights: "public_domain",
          },
        },
      },
    ],
    cursor: "more",
    isDone: false,
  },
};
const pages = (patch: object = {}) => ({
  items: [],
  first: undefined,
  loading: false,
  refreshing: false,
  done: true,
  error: undefined,
  canLoadMore: false,
  loadMore: mockLoadMore,
  refresh: mockRefresh,
  ...patch,
});
beforeEach(() => {
  jest.clearAllMocks();
  mockSession = {
    key: "account-a",
    token: "private-token",
    profileId: "viewer" as never,
    status: "ready",
    offline: false,
    accountReady: true,
    error: undefined,
    refresh: mockRefresh,
  };
  mockPages.mockReturnValue(pages());
  mockQuery.mockReturnValue({ data: undefined, refresh: mockRefresh });
  mockSuggestions = { people: [] };
  process.env.EXPO_PUBLIC_CONVEX_SITE_URL = "https://test.convex.site";
});

it("opens visits, authors, and people from Home", async () => {
  mockPages.mockReturnValue(pages({ items: [visit] }));
  await render(<HomeScreen />);
  expect(screen.queryByText("Newest visit first")).toBeNull();
  expect(screen.queryByText("1+ artworks")).toBeNull();
  expect(screen.getByText(visit.reflection)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "View visit" }));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: "/visit/[postId]",
    params: { postId: visit.postId },
  });
  await fireEvent.press(
    screen.getByRole("button", {
      name: "View Alex Chen’s visit to Museum of Modern Art",
    }),
  );
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: "/visit/[postId]",
    params: { postId: visit.postId },
  });
  expect(screen.getByLabelText("September 12, 2026")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "View Alex Chen’s profile" }));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: "/profile/[profileId]",
    params: { profileId: "alex" },
  });
  await fireEvent.press(screen.getByRole("button", { name: "Find friends" }));
  expect(mockPush).toHaveBeenLastCalledWith("/people");
  await fireEvent.press(screen.getByRole("button", { name: "Friends", selected: true }));
  expect(mockPush).toHaveBeenLastCalledWith("/people");
  await fireEvent.press(screen.getByRole("button", { name: "Leaderboards" }));
  expect(mockPush).toHaveBeenLastCalledWith("/leaderboards");
  expect(screen.queryByRole("button", { name: "Your profile and settings" })).toBeNull();
});

it("keeps Home navigation available through ghosts, loaded content, and pagination", async () => {
  mockPages.mockReturnValue(pages({ loading: true, done: false }));
  const view = await render(<HomeScreen />);
  expect(screen.getByRole("progressbar", { name: "Loading visits…" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Find friends" })).toBeOnTheScreen();
  expect(screen.queryByText("No visits from friends yet.")).toBeNull();
  mockPages.mockReturnValue(pages({ items: [visit], loading: true, done: false }));
  await view.rerender(<HomeScreen />);
  expect(screen.getByText(visit.reflection)).toBeOnTheScreen();
  expect(screen.getAllByRole("progressbar", { name: "Loading visits…" })).toHaveLength(1);
  mockPages.mockReturnValue(pages({ items: [visit] }));
  await view.rerender(<HomeScreen />);
  expect(screen.queryByRole("progressbar", { name: "Loading visits…" })).toBeNull();
  expect(screen.getByText(visit.reflection)).toBeOnTheScreen();
});

it("replaces first-load ghosts with a retry action after failure", async () => {
  mockPages.mockReturnValue(pages({ loading: true, done: false }));
  const view = await render(<HomeScreen />);
  mockPages.mockReturnValue(pages({ error: new Error("Offline"), done: false }));
  await view.rerender(<HomeScreen />);
  expect(screen.queryByRole("progressbar")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});

it("retains existing visits and shows only the pull spinner while refreshing", async () => {
  mockPages.mockReturnValue(pages({ items: [visit] }));
  const view = await render(<HomeScreen />);
  await act(() => lastRefreshControl().onRefresh?.());
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  mockPages.mockReturnValue(pages({ items: [visit], loading: true, refreshing: true, done: false }));
  await view.rerender(<HomeScreen />);
  expect(screen.getByText(visit.reflection)).toBeOnTheScreen();
  expect(lastRefreshControl().refreshing).toBe(true);
  expect(screen.queryByRole("progressbar")).toBeNull();
});

it.each([
  ["offline", "You’re offline."],
  ["loading", "Loading your account…"],
] as const)("gates private Home content while %s", async (status, expected) => {
  mockSession = { ...mockSession, status };
  mockPages.mockReturnValue(pages({ items: [visit] }));
  await render(<HomeScreen />);
  expect(status === "loading" ? screen.getByLabelText(expected) : screen.getByText(expected)).toBeOnTheScreen();
  expect(screen.queryByText(visit.reflection)).toBeNull();
  expect(mockPages.mock.calls[0][1]).toBe("skip");
});

it("waits for finished pagination before showing empty copy, ends without a caption, and offers retry", async () => {
  mockPages.mockReturnValue(pages({ done: false, canLoadMore: true }));
  const view = await render(<HomeScreen />);
  expect(screen.queryByText("No visits from friends yet.")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "More visits" }));
  expect(mockLoadMore).toHaveBeenCalled();
  mockPages.mockReturnValue(pages({ items: [visit], done: true }));
  await view.rerender(<HomeScreen />);
  expect(screen.getByText(visit.reflection)).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "More visits" })).toBeNull();
  expect(screen.queryByText(/shown\./)).toBeNull();
  mockPages.mockReturnValue(pages({ done: false, error: new Error("offline") }));
  await view.rerender(<HomeScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
  expect(mockRefresh).toHaveBeenCalled();
});

it("debounces people search for 300 ms and skips invalid searches", async () => {
  jest.useFakeTimers();
  await render(<PeopleScreen />);
  await fireEvent.changeText(screen.getByLabelText("Name or username"), "alex");
  expect(mockPages.mock.calls.filter((call) => getFunctionName(call[0]) === "profiles:search").at(-1)[1]).toBe("skip");
  await act(() => jest.advanceTimersByTime(299));
  expect(mockPages.mock.calls.filter((call) => getFunctionName(call[0]) === "profiles:search").at(-1)[1]).toBe("skip");
  await act(() => jest.advanceTimersByTime(1));
  expect(mockPages.mock.calls.filter((call) => getFunctionName(call[0]) === "profiles:search").at(-1)[1]).toEqual({
    query: "alex",
  });
  await fireEvent.changeText(screen.getByLabelText("Name or username"), "a".repeat(101));
  await act(() => jest.advanceTimersByTime(300));
  expect(mockPages.mock.calls.filter((call) => getFunctionName(call[0]) === "profiles:search").at(-1)[1]).toBe("skip");
  jest.useRealTimers();
});

it("opens read-only artwork details from a visit and handles revoked posts", async () => {
  mockPages.mockReturnValue(pages({ items: visit.artworks.page, first: visit }));
  const view = await render(<VisitScreen postId={visit.postId} />);
  await fireEvent.press(screen.getByRole("button", { name: "View Blue afternoon" }));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: "/artwork",
    params: { kind: "visit", postId: "post-a", itemId: "art-a" },
  });
  mockPages.mockReturnValue(pages({ error: new ConvexError({ code: "not_found" }), done: false }));
  await view.rerender(<VisitScreen postId={visit.postId} />);
  expect(screen.getByText("Visit unavailable.")).toBeOnTheScreen();
  expect(screen.queryByText(visit.reflection)).toBeNull();
});

it("shows only the public wall note and never a visit’s private note", async () => {
  mockQuery.mockImplementation((query) => ({
    data:
      getFunctionName(query) === "walls:getArtwork"
        ? {
            ...visit.artworks.page[0],
            layout: { x: 0.1, y: 0.1, width: 0.3, layer: 0, frame: "gilt" },
            note: "Selected public note",
          }
        : { ...visit.artworks.page[0], note: "Private note" },
    refresh: mockRefresh,
  }));
  const view = await render(<ArtworkScreen kind="wall" itemId="wall-item" />);
  expect(screen.getByText("Selected public note")).toBeOnTheScreen();
  await view.rerender(<ArtworkScreen kind="visit" itemId="visit-item" postId="post-a" />);
  expect(screen.queryByText("Selected public note")).toBeNull();
  expect(screen.queryByText("Private note")).toBeNull();
});

it.each([false, true])(
  "keeps artwork proportions, credentials, and the unavailable-image fallback (compact: %s)",
  async (compact) => {
    const item = {
      ...visit.artworks.page[0],
      artwork: {
        ...visit.artworks.page[0].artwork,
        media: {
          kind: "derivative" as const,
          rights: "contributor_consent" as const,
          width: 128,
          height: 256,
          reference: {
            kind: "sharedVisit" as const,
            postId: "post-a",
            itemId: "art-a" as never,
          },
        },
      },
    };
    await render(<VisitArtworks artworks={[item]} token="private-token" compact={compact} />);
    await fireEvent(screen.getByTestId("visit-artworks"), "layout", {
      nativeEvent: { layout: { width: 390 } },
    });
    const image = screen.getByRole("image", { name: "Blue afternoon" });
    expect(image.props.style.height / image.props.style.width).toBe(2);
    expect(image.props.contentFit).toBe("contain");
    expect(image.props.cachePolicy).toBe("memory");
    expect(image.props.source.headers).toEqual({
      Authorization: "Bearer private-token",
    });
    await fireEvent(image, "error");
    expect(screen.getByRole("image", { name: "Blue afternoon: image unavailable" })).toBeOnTheScreen();
  },
);

it("shows fewer previews rather than letting landscape photos overflow the card", async () => {
  const landscape = (itemId: string) => ({
    ...visit.artworks.page[0],
    itemId: itemId as never,
    artwork: {
      ...visit.artworks.page[0].artwork,
      title: itemId,
      media: {
        kind: "derivative" as const,
        rights: "contributor_consent" as const,
        width: 400,
        height: 300,
        reference: {
          kind: "sharedVisit" as const,
          postId: "post-a",
          itemId: itemId as never,
        },
      },
    },
  });
  await render(<VisitArtworks artworks={["one", "two", "three"].map(landscape)} compact />);
  await fireEvent(screen.getByTestId("visit-artworks"), "layout", {
    nativeEvent: { layout: { width: 350 } },
  });
  expect(screen.getByRole("image", { name: "one" })).toBeOnTheScreen();
  expect(screen.getByRole("image", { name: "two" })).toBeOnTheScreen();
  expect(screen.queryByRole("image", { name: "three" })).toBeNull();
  const image = screen.getByRole("image", { name: "one" });
  expect(image.props.style.width * 2 + 8).toBeLessThanOrEqual(350);
  expect(image.props.style.height).toBeGreaterThanOrEqual(100);
});

it("gives all selected photos in a visit the same height, including an unavailable photo", async () => {
  const item = visit.artworks.page[0];
  const photo = {
    kind: "catalog" as const,
    url: "https://example.com/full.jpg",
    sourceUrl: "https://example.com/artwork",
    rights: "public_domain" as const,
    width: 300,
    height: 400,
  };
  await render(
    <VisitArtworks
      artworks={[
        {
          ...item,
          photos: [
            photo,
            {
              ...photo,
              url: "https://example.com/detail.jpg",
              width: 500,
              height: 300,
            },
          ],
        },
      ]}
      compact
    />,
  );
  await fireEvent(screen.getByTestId("visit-artworks"), "layout", {
    nativeEvent: { layout: { width: 350 } },
  });
  const full = screen.getByRole("image", { name: item.artwork.title });
  const detail = screen.getByRole("image", {
    name: `${item.artwork.title}, photo 2`,
  });
  expect(full.props.style.height).toBe(detail.props.style.height);
  await fireEvent(detail, "error");
  expect(
    screen.getByRole("image", {
      name: `${item.artwork.title}, photo 2: image unavailable`,
    }),
  ).toHaveStyle({ height: full.props.style.height });
});

const highlightArtworks = () => {
  const item = visit.artworks.page[0];
  const photo = {
    kind: "catalog" as const,
    url: "https://example.com/full.jpg",
    sourceUrl: "https://example.com/artwork",
    rights: "public_domain" as const,
    width: 300,
    height: 400,
  };
  return [
    {
      ...item,
      photos: [
        photo,
        { ...photo, url: "https://example.com/second.jpg" },
        { ...photo, url: "https://example.com/third.jpg" },
      ],
    },
    {
      ...item,
      itemId: "art-b" as never,
      artwork: { ...item.artwork, title: "Second highlight" },
    },
    {
      ...item,
      itemId: "art-c" as never,
      artwork: { ...item.artwork, title: "Third highlight" },
    },
  ];
};

it("keeps a feed slot for every leading artwork even when the first one has several photos", async () => {
  await render(<VisitArtworks artworks={highlightArtworks()} compact />);
  await fireEvent(screen.getByTestId("visit-artworks"), "layout", {
    nativeEvent: { layout: { width: 350 } },
  });
  for (const title of ["Blue afternoon", "Second highlight", "Third highlight"]) {
    expect(screen.getByRole("image", { name: title })).toBeOnTheScreen();
  }
  expect(screen.queryByRole("image", { name: "Blue afternoon, photo 2" })).toBeNull();
});

it("fills spare feed slots with extra photos when fewer than three artworks lead the visit", async () => {
  await render(<VisitArtworks artworks={highlightArtworks().slice(0, 2)} compact />);
  await fireEvent(screen.getByTestId("visit-artworks"), "layout", {
    nativeEvent: { layout: { width: 350 } },
  });
  for (const title of ["Blue afternoon", "Blue afternoon, photo 2", "Second highlight"]) {
    expect(screen.getByRole("image", { name: title })).toBeOnTheScreen();
  }
  expect(screen.queryByRole("image", { name: "Blue afternoon, photo 3" })).toBeNull();
});

it("loads public visits for guests and opens their details without signing in", async () => {
  mockSession = { ...mockSession, status: "signed-out", token: null };
  mockPages.mockReturnValue(pages({ items: [{ ...visit, audience: "public" }] }));
  await render(<HomeScreen />);
  expect(mockPages.mock.calls.map(([query, args]) => [getFunctionName(query), args])).toEqual([
    ["sharedVisits:listFeed", "skip"],
    ["sharedVisits:listPublic", {}],
    ["notifications:unseen", "skip"],
  ]);
  expect(screen.getByRole("button", { name: "Global", selected: true })).toBeOnTheScreen();
  expect(screen.getByText(visit.reflection)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "View visit" }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/visit/[postId]",
    params: { postId: visit.postId },
  });
  expect(screen.getByRole("button", { name: "Sign in" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Dismiss sign-in invitation" }));
  expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
});

it("switches a signed-in Home between friends’ visits and Global public visits", async () => {
  await render(<HomeScreen />);
  const subscriptions = mockPages.mock.calls.map(
    ([query, args]) => `${getFunctionName(query)} ${JSON.stringify(args)}`,
  );
  expect([...new Set(subscriptions)]).toEqual([
    "sharedVisits:listFeed {}",
    "sharedVisits:listPublic {}",
    "notifications:unseen {}",
  ]);
  expect(screen.getByRole("button", { name: "Global", selected: true })).toBeOnTheScreen();
  expect(screen.getByText("No public visits yet.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Friends" }));
  expect(screen.getByText("No visits from friends yet.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Browse Global" }));
  expect(screen.getByRole("button", { name: "Global", selected: true })).toBeOnTheScreen();
  expect(
    mockPages.mock.calls.filter(([query]) => getFunctionName(query) === "sharedVisits:listPublic").at(-1)?.[1],
  ).toEqual({});
  expect(screen.getByText("No public visits yet.")).toBeOnTheScreen();
});

it.each([
  ["signed-out", "Sign in to add friends."],
  ["profile-required", "Create a public profile."],
] as const)("opens Global while %s and gates the Friends tab", async (status, gate) => {
  mockSession = { ...mockSession, status, token: null };
  mockPages.mockReturnValue(pages({ items: [visit] }));
  await render(<HomeScreen />);
  expect(screen.getByText(visit.reflection)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Friends" }));
  expect(screen.getByRole("header", { name: gate })).toBeOnTheScreen();
  expect(screen.queryByText(visit.reflection)).toBeNull();
  expect(screen.queryByRole("button", { name: "Dismiss sign-in invitation" }) !== null).toBe(status === "signed-out");
  expect(
    mockPages.mock.calls
      .filter(([query]) => getFunctionName(query) === "sharedVisits:listFeed")
      .map(([, args]) => args),
  ).toEqual(["skip", "skip"]);
  await fireEvent.press(screen.getByRole("button", { name: "Browse Global" }));
  expect(screen.getByText(visit.reflection)).toBeOnTheScreen();
});

it("offers public walls while the public visit feed is empty", async () => {
  mockSession = { ...mockSession, status: "signed-out" };
  await render(<HomeScreen />);
  expect(screen.getByText("No public visits yet.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "View public walls" }));
  expect(mockPush).toHaveBeenCalledWith("/people");
});

it("shows a direct invitation for guest Friends and keeps public discovery one tap away", async () => {
  mockSession = { ...mockSession, status: "signed-out", token: null };
  await render(<PeopleScreen />);
  const search = screen.getByLabelText("Name or username");
  await fireEvent.press(screen.getByRole("button", { name: "Friends" }));
  expect(screen.queryByText("EXAMPLE")).toBeNull();
  expect(screen.getByRole("header", { name: "Sign in to add friends." })).toBeOnTheScreen();
  expect(screen.getByLabelText("Name or username")).toBe(search);
  expect(search).toHaveProp("editable", false);
  expect(screen.queryByText("An afternoon of art")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Continue with Apple" }));
  expect(mockSignIn).toHaveBeenCalledTimes(1);
  expect(mockPush).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Find friends" }));
  expect(screen.getByRole("button", { name: "Explore" })).toBeSelected();
  expect(screen.getByLabelText("Name or username")).toBe(search);
  expect(search).toHaveProp("editable", true);
  expect(screen.queryByText("EXAMPLE")).toBeNull();
});

it("keeps the date and reflection without count metadata, including reflection-only visits", async () => {
  mockPages.mockReturnValue(pages({ items: [{ ...visit, artworkCount: 6 }] }));
  const view = await render(<HomeScreen />);
  expect(screen.queryByText("+5 more")).toBeNull();
  expect(screen.queryByText("6 artworks")).toBeNull();
  expect(screen.getByLabelText("September 12, 2026")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "View visit" }));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: "/visit/[postId]",
    params: { postId: visit.postId },
  });
  mockPages.mockReturnValue(
    pages({
      items: [
        {
          ...visit,
          artworkCount: 0,
          artworks: { page: [], cursor: null, isDone: true },
        },
      ],
    }),
  );
  await view.rerender(<HomeScreen />);
  expect(screen.queryByTestId("visit-artworks")).toBeNull();
  expect(screen.getByText(visit.reflection)).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "View visit" })).toBeOnTheScreen();
});

it.each(["wall", "visit"])("renders sourced artwork stories in %s details", async (kind) => {
  mockQuery.mockReturnValue({
    data: {
      ...visit.artworks.page[0],
      layout: { frame: "gilt" },
      enrichment: {
        docent: [{ sentence: "Painted beside the garden.", factIds: ["museum"] }],
        factSheet: [
          {
            id: "museum",
            sourceUrl: "https://museum.example/work",
            sourceLabel: "Museum source",
          },
        ],
      },
    },
    refresh: mockRefresh,
  });
  await render(<ArtworkScreen kind={kind} itemId="art-a" postId="post-a" />);
  expect(screen.getByText("About this work")).toBeOnTheScreen();
  expect(screen.getByText("Painted beside the garden.")).toBeOnTheScreen();
  expect(screen.getByText("Museum source")).toBeOnTheScreen();
});

it("waits for completed discovery before inviting a first scan", async () => {
  mockPages.mockReturnValue(pages({ loading: true, done: false }));
  const view = await render(<PeopleScreen />);
  expect(screen.queryByText("No public profiles yet.")).toBeNull();
  mockPages.mockReturnValue(pages({ error: new Error("Offline"), done: true }));
  await view.rerender(<PeopleScreen />);
  expect(screen.queryByText("No public profiles yet.")).toBeNull();
  mockPages.mockReturnValue(pages());
  await view.rerender(<PeopleScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Scan artwork" }));
  expect(mockDismissAll).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenLastCalledWith("/scan");
});

it("renders Explore rows from the relationship embedded in each page instead of one friendship query per person", async () => {
  const person = (profileId: string, relationship: object) => ({
    profileId: profileId as never,
    name: profileId,
    username: profileId,
    avatar: "vermeer" as const,
    publishedWallCount: 0,
    relationship,
  });
  mockPages.mockReturnValue(
    pages({
      items: [
        person("friend", {
          state: "accepted",
          revision: 3,
          requesterId: null,
          blocked: false,
          blockRevision: 0,
        }),
        person("asked", {
          state: "pending",
          revision: 1,
          requesterId: "viewer",
          blocked: false,
          blockRevision: 0,
        }),
        person("stranger", {
          state: "none",
          revision: 0,
          requesterId: null,
          blocked: false,
          blockRevision: 0,
        }),
      ],
    }),
  );
  mockQuery.mockReturnValue({ data: [], loading: false, refresh: mockRefresh });
  await render(<PeopleScreen />);
  expect(screen.getByRole("button", { name: "Requested" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Add" })).toBeOnTheScreen();
  expect(screen.getAllByRole("button", { name: /^(Add|Requested|Accept)$/ })).toHaveLength(2);
  expect(
    mockQuery.mock.calls.filter((call) => getFunctionName(call[0]) === "friendships:getState").map((call) => call[1]),
  ).toEqual(["skip", "skip"]);
});

it("keeps discovery search available when a member has no friends", async () => {
  mockQuery.mockReturnValue({ data: [], loading: false, refresh: mockRefresh });
  await render(<PeopleScreen />);
  const search = screen.getByLabelText("Name or username");
  await fireEvent.press(screen.getByRole("button", { name: "Friends" }));
  expect(screen.getByRole("header", { name: "No friends added yet." })).toBeOnTheScreen();
  expect(screen.getByLabelText("Name or username")).toBe(search);
  await fireEvent.press(screen.getByRole("button", { name: "Find friends" }));
  expect(screen.getByLabelText("Name or username")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Explore" })).toBeSelected();
});

it("keeps the discovery header mounted while searching and switching filters", async () => {
  mockQuery.mockReturnValue({ data: [], loading: false, refresh: mockRefresh });
  await render(<PeopleScreen />);
  const title = screen.getByRole("header", { name: "Friends" });
  const search = screen.getByLabelText("Name or username");
  await fireEvent.changeText(search, "alex");
  for (const name of ["Friends", "Explore"]) {
    await fireEvent.press(screen.getByRole("button", { name }));
    expect(screen.getByRole("header", { name: "Friends" })).toBe(title);
    expect(screen.getByLabelText("Name or username")).toBe(search);
    expect(search).toHaveProp("value", "alex");
  }
});

const none = { state: "none" as const, revision: 0, requesterId: null, blocked: false, blockRevision: 0 };
const profile = (name: string) => ({
  profileId: name.toLowerCase().replaceAll(" ", "-") as never,
  name,
  username: name.toLowerCase().replaceAll(" ", ""),
  avatar: "vermeer" as const,
  publishedWallCount: 0,
});
const maya: Suggestion = {
  profile: { ...profile("Maya Chen"), relationship: none },
  reason: { kind: "mutual", count: 3, friends: [profile("Theo Alvarez"), profile("Sam Okafor")] },
};
const priya: Suggestion = {
  profile: { ...profile("Priya Nair"), relationship: none },
  reason: { kind: "artwork", artwork: { itemId: "lilies" as never, artwork: visit.artworks.page[0].artwork } },
};
const queryData = (data: Record<string, unknown>) =>
  mockQuery.mockImplementation((query) => ({
    data: data[getFunctionName(query)],
    loading: false,
    refresh: mockRefresh,
  }));

it("leads Explore with requests and suggestions, each saying why, above the newest profiles", async () => {
  mockSuggestions = { people: [maya, priya], friendCount: 3 };
  queryData({
    "profiles:requests": [
      {
        ...profile("Lucía Romero"),
        relationship: { ...none, state: "pending", revision: 1, requesterId: "lucía-romero" },
      },
    ],
    "profiles:friends": [],
  });
  mockPages.mockReturnValue(pages({ items: [{ ...profile("Ruth Mendel"), relationship: none }, maya.profile] }));
  await render(<PeopleScreen />);
  expect(screen.getByRole("header", { name: "Requests" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Accept" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Ignore request" })).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Suggested" })).toBeOnTheScreen();
  expect(screen.getByText("Friends with Theo and 2 others", { includeHiddenElements: true })).toBeOnTheScreen();
  expect(screen.getByText("Also saved Blue afternoon", { includeHiddenElements: true })).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "New on Artlog" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "View Ruth Mendel’s profile" })).toBeOnTheScreen();
  expect(screen.getAllByRole("button", { name: "View Maya Chen’s profile" })).toHaveLength(1);
  await fireEvent.press(screen.getByRole("button", { name: "Hide Maya Chen from suggestions" }));
  expect(mockDismissSuggestion).toHaveBeenCalledWith(maya);

  await fireEvent.press(screen.getByRole("button", { name: "Friends" }));
  expect(screen.queryByRole("header", { name: "Requests" })).toBeNull();
  expect(screen.queryByText("Friends with Theo and 2 others", { includeHiddenElements: true })).toBeNull();
});

it("narrows your friends as you type, highlighting the match, and opens a friend’s profile", async () => {
  queryData({ "profiles:friends": [profile("Maya Chen"), profile("Ruth Mendel")], "profiles:requests": [] });
  await render(<PeopleScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Friends" }));
  expect(screen.getByRole("header", { name: "Your friends 2" })).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("Name or username"), "ruth");
  expect(screen.queryByRole("button", { name: "View Maya Chen’s profile" })).toBeNull();
  expect(screen.getByText("Ruth", { includeHiddenElements: true })).toHaveStyle({ backgroundColor: Gallery.highlight });
  await fireEvent.press(screen.getByRole("button", { name: "View Ruth Mendel’s profile" }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/profile/[profileId]", params: { profileId: "ruth-mendel" } });
});

it("shows suggestion cards above a short Friends feed, ending with an invitation", async () => {
  mockSuggestions = { people: [maya], friendCount: 2 };
  queryData({ "profiles:requests": [] });
  mockPages.mockReturnValue(pages({ items: [visit] }));
  const view = await render(<HomeScreen />);
  expect(screen.getByRole("header", { name: "Suggested" })).toBeOnTheScreen();
  expect(screen.getByText("Friends with Theo and 2 others", { includeHiddenElements: true })).toBeOnTheScreen();
  expect(screen.getByText("Invite friends")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Share" }));
  expect(mockPush).toHaveBeenLastCalledWith("/share-profile");
  await fireEvent.press(screen.getByRole("button", { name: "See all" }));
  expect(mockPush).toHaveBeenLastCalledWith("/people");

  mockSuggestions = { people: [maya], friendCount: 5 };
  await view.rerender(<HomeScreen />);
  expect(screen.queryByText("Invite friends")).toBeNull();
  expect(screen.getByText(visit.reflection)).toBeOnTheScreen();
});

it("fills an empty Friends feed with suggestions and counts requests on the friends button", async () => {
  mockSuggestions = { people: [priya], friendCount: 0 };
  queryData({ "profiles:requests": [profile("Ben Carter"), profile("Lucía Romero")] });
  await render(<HomeScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Friends" }));
  expect(screen.getByRole("header", { name: "No visits from friends yet." })).toBeOnTheScreen();
  expect(screen.getByText("Also saved Blue afternoon", { includeHiddenElements: true })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Share your profile" }));
  expect(mockPush).toHaveBeenLastCalledWith("/share-profile");
  await fireEvent.press(screen.getByRole("button", { name: "Find friends, 2 requests" }));
  expect(mockPush).toHaveBeenLastCalledWith("/people");
});
