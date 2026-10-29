import { fireEvent, render, screen, within } from "@testing-library/react-native";
import type { RequestForQueries } from "convex/react";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import type { PropsWithChildren } from "react";
import { Platform } from "react-native";

import { scrollViewHolding } from "@/components/scroll-view.testing";
import { reportError } from "@/lib/observability";
import type { SharedVisit } from "@/lib/social/types";
import { UnseenNotificationCount } from "@/lib/social/unseen-notifications";
import type { SocialSession } from "@/lib/social/use-social-session";

import { HomeScreen } from "./home-screen";

let mockSession: SocialSession;
let mockUnseen: number;
let mockParams: { feed?: string; posted?: string };
let mockDelivered: Record<string, unknown>;
const mockSubscriptions = new Map<object, RequestForQueries>();
const mockPush = jest.fn();
const mockNavigate = jest.fn();
let mockVisit: object | undefined;
let mockSaves: { localId: string; title: string; cropPath: null }[];
let mockJudgesDemo = false;
jest.mock("@/lib/social/use-social-session", () => ({ useSocialSession: () => mockSession }));
jest.mock("@/components/account/welcome-prompt", () => ({ WelcomePrompt: () => null }));
jest.mock("@/components/visits/now-card", () => ({
  NowCard: () => null,
  useNowCardScroll: () => ({ onCardLayout: () => {}, onScroll: () => {} }),
}));
jest.mock("@/components/visits/wrap-up-prompt", () => ({ WrapUpPrompt: () => null }));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));
jest.mock("@/lib/judges-demo", () => ({ isJudgesDemo: () => mockJudgesDemo }));
jest.mock("@/lib/venue/use-venue", () => ({ useVenue: () => ({ visit: mockVisit }) }));
jest.mock("@/lib/journal/visitless-saves", () => ({
  sharedMuseum: () => undefined,
  useMakeVisit: () => ({ busy: false, make: jest.fn() }),
  useVisitlessSavesToday: () => ({ saves: mockSaves, dismiss: jest.fn() }),
}));
jest.mock("@convex-dev/auth/react", () => ({ useAuthToken: () => mockSession.token }));
jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));
jest.mock("expo-router", () => {
  const { mockStack } = jest.requireActual("@/components/stack-toolbar-mock");
  const { Platform, Text } = jest.requireActual("react-native");
  // UIKit ignores toolbar badges before iOS 26.
  mockStack.Toolbar.Badge = ({ children }: { children: string }) =>
    Number.parseInt(String(Platform.Version), 10) >= 26 ? <Text>{children}</Text> : null;
  return {
    useLocalSearchParams: () => mockParams,
    useRouter: () => ({ push: mockPush, navigate: mockNavigate }),
    Stack: mockStack,
  };
});
jest.mock("./visit-card", () => ({
  VisitCard: ({ visit }: { visit: SharedVisit }) => {
    const { Text } = jest.requireActual("react-native");
    return <Text>{visit.venue.name}</Text>;
  },
}));
jest.mock("convex/react", () => ({
  useMutation: () => jest.fn(),
  useQueries: (requests: RequestForQueries) => {
    const { useEffect, useRef } = jest.requireActual<typeof import("react")>("react");
    const subscription = useRef({}).current;
    useEffect(() => {
      mockSubscriptions.set(subscription, requests);
      const retained = new Set([...mockSubscriptions.values()].flatMap(Object.keys));
      for (const key of Object.keys(mockDelivered)) {
        if (!retained.has(key)) delete mockDelivered[key];
      }
    }, [requests, subscription]);
    useEffect(
      () => () => {
        mockSubscriptions.delete(subscription);
      },
      [subscription],
    );
    return Object.fromEntries(Object.keys(requests).map((key) => [key, mockDelivered[key]]));
  },
}));

function UnseenCount({ children }: PropsWithChildren) {
  return <UnseenNotificationCount value={mockUnseen}>{children}</UnseenNotificationCount>;
}

const renderHome = () => render(<HomeScreen />, { wrapper: UnseenCount });

function page(name: string, cursor: string | null = null) {
  return {
    page: [{ postId: name, venue: { name } }],
    cursor,
    isDone: cursor === null,
  };
}

/** Lays out the scroll content's header: the page title, then `cards` points of header cards above the feed. */
async function layOutHeader(cards: number) {
  const titleHeight = 69;
  await fireEvent(screen.getByRole("header", { name: "Artlog" }), "layout", {
    nativeEvent: { layout: { x: 0, y: 0, width: 390, height: titleHeight } },
  });
  await fireEvent(screen.getByTestId("home-feed-start"), "layout", {
    nativeEvent: { layout: { x: 0, y: titleHeight + cards, width: 390, height: 0 } },
  });
}

async function deliver(pages: Record<string, unknown>) {
  for (const requests of mockSubscriptions.values()) {
    for (const [key, request] of Object.entries(requests)) {
      const pageKey = `${getFunctionName(request.query)}:${String(request.args.cursor ?? "first")}`;
      if (pageKey in pages) mockDelivered[key] = pages[pageKey];
    }
  }
  await screen.rerender(<HomeScreen />);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Platform, "Version", "get").mockReturnValue("26.5");
  mockSubscriptions.clear();
  mockDelivered = {};
  mockParams = {};
  mockUnseen = 0;
  mockVisit = undefined;
  mockSaves = [];
  mockJudgesDemo = false;
  mockSession = {
    scope: "scope-a",
    status: "ready",
    key: "account-a",
    token: "token-a",
    profileId: "profile-a" as never,
    offline: false,
    accountReady: true,
    safetyChecks: true,
    safetyChecksAnswered: true,
    prefetch: { public: false, profile: false },
    refresh: jest.fn(),
    error: undefined,
  };
});

afterEach(() => jest.restoreAllMocks());

it("switches between loaded feeds without flashing loading placeholders", async () => {
  await renderHome();
  await deliver({
    "sharedVisits:listFeed:first": page("Friends museum"),
    "sharedVisits:listPublic:first": page("Global museum"),
  });
  expect(screen.getByText("Friends museum")).toBeOnTheScreen();
  for (let i = 0; i < 3; i++) {
    await fireEvent.press(screen.getByRole("button", { name: "Global" }));
    expect(screen.getByText("Global museum")).toBeOnTheScreen();
    expect(screen.queryByText("Friends museum")).toBeNull();
    expect(screen.queryByLabelText("Loading visits…")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Friends" }));
    expect(screen.getByText("Friends museum")).toBeOnTheScreen();
    expect(screen.queryByText("Global museum")).toBeNull();
    expect(screen.queryByLabelText("Loading visits…")).toBeNull();
  }
});

it.each(["17.7", "18.7", "26.5"])("shows counts and opens each toolbar destination on iOS %s", async (version) => {
  jest.spyOn(Platform, "Version", "get").mockReturnValue(version);
  mockUnseen = 2;
  await renderHome();
  await deliver({ "profiles:requests:first": [{ profileId: "friend" }] });
  const friends = screen.getByRole("button", { name: "Find Friends, 1 request" });
  expect(screen.getByText("1", { includeHiddenElements: true })).toBeOnTheScreen();
  await fireEvent.press(friends);
  expect(mockPush).toHaveBeenLastCalledWith("/people");
  const notifications = screen.getByRole("button", { name: "Notifications, 2 new" });
  expect(screen.getByText("2", { includeHiddenElements: true })).toBeOnTheScreen();
  await fireEvent.press(notifications);
  expect(mockPush).toHaveBeenLastCalledWith("/notifications");
  await fireEvent.press(screen.getByRole("button", { name: "Leaderboards" }));
  expect(mockPush).toHaveBeenLastCalledWith("/leaderboards");
});

it.each(["17.7", "18.7", "26.5"])("caps counts and removes zero badges on iOS %s", async (version) => {
  jest.spyOn(Platform, "Version", "get").mockReturnValue(version);
  mockUnseen = 100;
  await renderHome();
  await deliver({
    "profiles:requests:first": Array.from({ length: 120 }, (_, index) => ({ profileId: `friend-${index}` })),
  });
  expect(screen.getByRole("button", { name: "Find Friends, 120 requests" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Notifications, 99+ new" })).toBeOnTheScreen();
  expect(screen.getAllByText("99+", { includeHiddenElements: true })).toHaveLength(2);
  mockUnseen = 0;
  await deliver({ "profiles:requests:first": [] });
  expect(within(screen.getByRole("button", { name: "Find Friends" })).queryByText(/\d/)).toBeNull();
  expect(within(screen.getByRole("button", { name: "Notifications" })).queryByText(/\d/)).toBeNull();
  expect(screen.queryAllByText("99+", { includeHiddenElements: true })).toHaveLength(0);
});

it("retains loaded later pages separately for each feed", async () => {
  await renderHome();
  await deliver({
    "sharedVisits:listFeed:first": page("Friends museum", "friends-next"),
    "sharedVisits:listPublic:first": page("Global museum", "global-next"),
  });
  await fireEvent.press(screen.getByRole("button", { name: "More visits" }));
  await deliver({ "sharedVisits:listFeed:friends-next": page("Another friends museum") });
  await fireEvent.press(screen.getByRole("button", { name: "Global" }));
  await fireEvent.press(screen.getByRole("button", { name: "More visits" }));
  await deliver({ "sharedVisits:listPublic:global-next": page("Another global museum") });
  await fireEvent.press(screen.getByRole("button", { name: "Friends" }));
  expect(screen.getByText("Another friends museum")).toBeOnTheScreen();
  expect(screen.queryByText("Another global museum")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Global" }));
  expect(screen.getByText("Another global museum")).toBeOnTheScreen();
  expect(screen.queryByLabelText("Loading visits…")).toBeNull();
});

it("shows loading for a pending feed without displaying the other feed or an empty result", async () => {
  await renderHome();
  await deliver({ "sharedVisits:listFeed:first": page("Friends museum") });
  await fireEvent.press(screen.getByRole("button", { name: "Global" }));
  expect(screen.queryByText("Friends museum")).toBeNull();
  expect(screen.getByLabelText("Loading visits…")).toBeOnTheScreen();
  expect(screen.queryByText("No public visits yet.")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Friends" }));
  expect(screen.getByText("Friends museum")).toBeOnTheScreen();
});

// Re-tapping the Home tab scrolls to the content's top edge, which never re-expands a collapsed native large title.
it.each([
  ["ready", () => screen.getByText("Friends museum")],
  ["signed-out", () => screen.getByRole("header", { name: "Add your friends." })],
  ["loading", () => screen.getByRole("progressbar", { name: "Loading your account…" })],
] as const)("titles the page first in its scroll content while the account is %s", async (status, content) => {
  mockSession.status = status;
  await renderHome();
  await deliver({ "sharedVisits:listFeed:first": page("Friends museum") });
  const list = scrollViewHolding(content());
  expect(within(list).getAllByRole("header")[0]).toHaveAccessibleName("Artlog");
});

it("holds the page still while the feed shows only its skeleton", async () => {
  await renderHome();
  await layOutHeader(0);
  const list = scrollViewHolding(screen.getByRole("progressbar", { name: "Loading visits…" }));
  expect(list.props.scrollEnabled).toBe(false);
  await deliver({ "sharedVisits:listFeed:first": page("Friends museum") });
  expect(screen.getByText("Friends museum")).toBeOnTheScreen();
  expect(list.props.scrollEnabled).toBe(true);
});

it.each(["ready", "loading"] as const)(
  "keeps saved artwork actions scrollable while the account is %s and the feed waits",
  async (status) => {
    mockSession.status = status;
    mockSaves = [{ localId: "save-one", title: "Water Lilies", cropPath: null }];
    await renderHome();
    const list = scrollViewHolding(screen.getByRole("button", { name: "Make it a visit" }));
    await layOutHeader(612);
    expect(list.props.scrollEnabled).toBe(true);
    mockSaves = [];
    await screen.rerender(<HomeScreen />);
    expect(screen.queryByRole("button", { name: "Make it a visit" })).toBeNull();
    await layOutHeader(0);
    expect(list.props.scrollEnabled).toBe(false);
  },
);

it("clears both feeds when the account changes and gates Friends for guests", async () => {
  await renderHome();
  await deliver({
    "sharedVisits:listFeed:first": page("Friends museum"),
    "sharedVisits:listPublic:first": page("Global museum"),
  });
  mockSession = { ...mockSession, key: "account-b" };
  await screen.rerender(<HomeScreen />);
  expect(screen.queryByText("Friends museum")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Global" }));
  expect(screen.queryByText("Global museum")).toBeNull();
  mockSession = { ...mockSession, key: "guest", status: "signed-out", token: null, profileId: undefined };
  await screen.rerender(<HomeScreen />);
  await deliver({ "sharedVisits:listPublic:first": page("Guest museum") });
  await fireEvent.press(screen.getByRole("button", { name: "Friends" }));
  expect(screen.getByText("Add your friends.")).toBeOnTheScreen();
  expect(screen.queryByText("Guest museum")).toBeNull();
  expect([...mockSubscriptions.values()].flatMap(Object.values).map(({ query }) => getFunctionName(query))).toEqual([
    "sharedVisits:listPublic",
  ]);
  await fireEvent.press(screen.getByRole("button", { name: "Global" }));
  expect(screen.getByText("Guest museum")).toBeOnTheScreen();
});

it("asks a guest to sign in once on the Friends feed, with the gate taking over after Not Now", async () => {
  mockSession = { ...mockSession, key: "guest", status: "signed-out", token: null, profileId: undefined };
  await renderHome();
  await fireEvent.press(screen.getByRole("button", { name: "Friends" }));
  expect(screen.getByRole("header", { name: "Add your friends." })).toBeOnTheScreen();
  expect(screen.queryByRole("header", { name: "Sign in to add friends." })).toBeNull();
  expect(screen.getAllByRole("button", { name: "Sign In" })).toHaveLength(1);
  await fireEvent.press(screen.getByRole("button", { name: "Not Now" }));
  expect(screen.getByRole("header", { name: "Sign in to add friends." })).toBeOnTheScreen();
  expect(screen.getAllByRole("button", { name: "Sign in" })).toHaveLength(1);
  await fireEvent.press(screen.getByRole("button", { name: "Browse Global" }));
  expect(screen.getByRole("button", { name: "Global", selected: true })).toBeOnTheScreen();
});

it("keeps the guest header consistent across feeds, including after dismissing the invitation", async () => {
  mockSession = { ...mockSession, key: "guest", status: "signed-out", token: null, profileId: undefined };
  await renderHome();
  expect(screen.getByText("Add your friends.")).toBeOnTheScreen();
  await layOutHeader(232);
  expect(scrollViewHolding(screen.getByRole("button", { name: "Sign In" })).props.scrollEnabled).toBe(true);
  await fireEvent.press(screen.getByRole("button", { name: "Friends" }));
  expect(screen.getByText("Add your friends.")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Leaderboards" })).toBeOnTheScreen();
  expect(within(screen.getByRole("button", { name: "Find Friends" })).queryByText(/\d/)).toBeNull();
  expect(within(screen.getByRole("button", { name: "Notifications" })).queryByText(/\d/)).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Not Now" }));
  expect(screen.queryByText("Add your friends.")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Global" }));
  expect(screen.queryByText("Add your friends.")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Friends" }));
  expect(screen.queryByText("Add your friends.")).toBeNull();
});

it("keeps the judges' demo on Global without friend sign-in prompts", async () => {
  mockJudgesDemo = true;
  mockSession = { ...mockSession, key: "guest", status: "signed-out", token: null, profileId: undefined };
  await renderHome();
  await deliver({ "sharedVisits:listPublic:first": page("Guest museum") });
  expect(screen.getByText("Guest museum")).toBeOnTheScreen();
  expect(screen.queryByText("Add your friends.")).toBeNull();
  expect(screen.queryByRole("button", { name: "Friends" })).toBeNull();
});

it("sends guests from the invitation to sign in for friends", async () => {
  mockSession = { ...mockSession, key: "guest", status: "signed-out", token: null, profileId: undefined };
  await renderHome();
  await fireEvent.press(screen.getByRole("button", { name: "Sign In" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/sign-in", params: { context: "friends" } });
});

it("opens the requested feed after posting and still lets the user switch feeds", async () => {
  await renderHome();
  await deliver({
    "sharedVisits:listFeed:first": page("Friends museum"),
    "sharedVisits:listPublic:first": page("Global museum"),
  });
  mockParams = { feed: "global", posted: "post-one" };
  await screen.rerender(<HomeScreen />);
  expect(screen.getByRole("button", { name: "Global", selected: true })).toBeOnTheScreen();
  expect(screen.getByText("Global museum")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Friends" }));
  expect(screen.getByText("Friends museum")).toBeOnTheScreen();
});

it("opens Global when friends have no visits and keeps it when a friend posts later", async () => {
  await renderHome();
  await deliver({ "sharedVisits:listPublic:first": page("Global museum") });
  expect(screen.queryByRole("button", { name: "Friends", selected: true })).toBeNull();
  expect(screen.queryByText("Global museum")).toBeNull();
  await deliver({ "sharedVisits:listFeed:first": { page: [], cursor: null, isDone: true } });
  expect(screen.getByRole("button", { name: "Global", selected: true })).toBeOnTheScreen();
  expect(screen.getByText("Global museum")).toBeOnTheScreen();
  await deliver({ "sharedVisits:listFeed:first": page("Friends museum") });
  expect(screen.getByRole("button", { name: "Global", selected: true })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Friends" }));
  expect(screen.getByText("Friends museum")).toBeOnTheScreen();
});

it("names the open feed on the toolbar menu, hiding it until Home knows which feed opens", async () => {
  await renderHome();
  expect(screen.queryByLabelText(/ feed$/)).toBeNull();
  await deliver({ "sharedVisits:listFeed:first": page("Friends museum") });
  expect(screen.getByLabelText("Friends feed")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Friends", selected: true })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Global" }));
  expect(screen.getByLabelText("Global feed")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Global", selected: true })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Friends", selected: false })).toBeOnTheScreen();
});

it.each([
  ["without a visit", undefined],
  ["under the Now card during a visit", { localId: "visit-1" }],
])("offers the empty feeds’ next steps %s", async (_, visit) => {
  mockVisit = visit;
  await renderHome();
  await deliver({
    "sharedVisits:listFeed:first": { page: [], cursor: null, isDone: true },
    "sharedVisits:listPublic:first": { page: [], cursor: null, isDone: true },
  });
  expect(screen.getByRole("header", { name: "No public visits yet." })).toBeOnTheScreen();
  // The empty feed's own Find friends follows the toolbar's.
  await fireEvent.press(screen.getAllByRole("button", { name: "Find friends" }).at(-1)!);
  expect(mockPush).toHaveBeenLastCalledWith("/people");
  await fireEvent.press(screen.getByRole("button", { name: "Scan an artwork" }));
  expect(mockNavigate).toHaveBeenLastCalledWith("/scan");
  await fireEvent.press(screen.getByRole("button", { name: "Friends" }));
  expect(screen.getByRole("header", { name: "No visits from friends yet." })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Browse Global" }));
  expect(screen.getByRole("button", { name: "Global", selected: true })).toBeOnTheScreen();
});

const subscribedQueries = () =>
  [...mockSubscriptions.values()].flatMap(Object.values).map(({ query }) => getFunctionName(query));

it("asks for both feeds while the session loads and shows them only once it is ready", async () => {
  const ready = mockSession;
  mockSession = {
    ...ready,
    status: "loading",
    scope: undefined,
    profileId: undefined,
    accountReady: false,
    prefetch: { public: true, profile: true },
  };
  await renderHome();
  expect(subscribedQueries()).toEqual(["sharedVisits:listFeed", "sharedVisits:listPublic"]);
  await deliver({
    "sharedVisits:listFeed:first": page("Friends museum"),
    "sharedVisits:listPublic:first": page("Global museum"),
  });
  expect(screen.getByLabelText("Loading your account…")).toBeOnTheScreen();
  expect(screen.queryByText("Friends museum")).toBeNull();
  expect(screen.queryByText("Global museum")).toBeNull();
  mockSession = ready;
  await screen.rerender(<HomeScreen />);
  expect(screen.getByText("Friends museum")).toBeOnTheScreen();
  expect(screen.queryByLabelText("Loading visits…")).toBeNull();
});

it.each(["profile_required", "sign_in_required", "device_not_registered"])(
  "keeps a %s failure of an early Friends feed off screen and unreported",
  async (code) => {
    mockSession = {
      ...mockSession,
      status: "loading",
      scope: undefined,
      profileId: undefined,
      accountReady: false,
      prefetch: { public: true, profile: true },
    };
    await renderHome();
    await deliver({
      "sharedVisits:listFeed:first": new ConvexError({ code }),
      "sharedVisits:listPublic:first": page("Global museum"),
    });
    expect(screen.getByLabelText("Loading your account…")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    mockSession = { ...mockSession, status: "profile-required", prefetch: { public: false, profile: false } };
    await screen.rerender(<HomeScreen />);
    expect(subscribedQueries()).toEqual(["sharedVisits:listPublic"]);
    expect(screen.getByText("Global museum")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(reportError).not.toHaveBeenCalled();
  },
);
