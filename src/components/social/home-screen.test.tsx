import { fireEvent, render, screen, within } from "@testing-library/react-native";
import type { RequestForQueries } from "convex/react";
import { getFunctionName } from "convex/server";
import type { PropsWithChildren } from "react";
import { Platform } from "react-native";

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
jest.mock("@/lib/social/use-social-session", () => ({ useSocialSession: () => mockSession }));
jest.mock("@/components/account/welcome-prompt", () => ({ WelcomePrompt: () => null }));
jest.mock("@/components/visits/now-card", () => ({
  NowCard: () => null,
  useNowCardScroll: () => ({ onCardLayout: () => {}, onScroll: () => {} }),
}));
jest.mock("@/components/visits/wrap-up-prompt", () => ({ WrapUpPrompt: () => null }));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));
jest.mock("@/lib/venue/use-venue", () => ({ useVenue: () => ({ visit: mockVisit }) }));
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
  expect(screen.getByText("Sign in to add friends.")).toBeOnTheScreen();
  expect([...mockSubscriptions.values()].flatMap(Object.values).map(({ query }) => getFunctionName(query))).toEqual([
    "sharedVisits:listPublic",
  ]);
  await fireEvent.press(screen.getByRole("button", { name: "Browse Global" }));
  expect(screen.getByText("Guest museum")).toBeOnTheScreen();
});

it("keeps the guest header consistent across feeds, including after dismissing the invitation", async () => {
  mockSession = { ...mockSession, key: "guest", status: "signed-out", token: null, profileId: undefined };
  await renderHome();
  expect(screen.getByText("Sign in to connect with friends.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Friends" }));
  expect(screen.getByText("Sign in to connect with friends.")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Leaderboards" })).toBeOnTheScreen();
  expect(within(screen.getByRole("button", { name: "Find Friends" })).queryByText(/\d/)).toBeNull();
  expect(within(screen.getByRole("button", { name: "Notifications" })).queryByText(/\d/)).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Dismiss sign-in invitation" }));
  expect(screen.queryByText("Sign in to connect with friends.")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Global" }));
  expect(screen.queryByText("Sign in to connect with friends.")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Friends" }));
  expect(screen.queryByText("Sign in to connect with friends.")).toBeNull();
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
  await fireEvent.press(screen.getByRole("button", { name: "View public walls" }));
  expect(mockPush).toHaveBeenLastCalledWith("/people");
  await fireEvent.press(screen.getByRole("button", { name: "Scan an artwork" }));
  expect(mockNavigate).toHaveBeenLastCalledWith("/scan");
  await fireEvent.press(screen.getByRole("button", { name: "Friends" }));
  expect(screen.getByRole("header", { name: "No visits from friends yet." })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Browse Global" }));
  expect(screen.getByRole("button", { name: "Global", selected: true })).toBeOnTheScreen();
});
