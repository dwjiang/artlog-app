import { fireEvent, render, screen } from "@testing-library/react-native";
import type { RequestForQueries } from "convex/react";
import { getFunctionName } from "convex/server";

import type { SharedVisit } from "@/lib/social/types";
import type { SocialSession } from "@/lib/social/use-social-session";

import { HomeScreen } from "./home-screen";

let mockSession: SocialSession;
let mockParams: { feed?: string; posted?: string };
let mockDelivered: Record<string, unknown>;
const mockSubscriptions = new Map<object, RequestForQueries>();
const mockPush = jest.fn();
jest.mock("@/lib/social/use-social-session", () => ({ useSocialSession: () => mockSession }));
jest.mock("@/components/account/welcome-prompt", () => ({ WelcomePrompt: () => null }));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));
jest.mock("@convex-dev/auth/react", () => ({ useAuthToken: () => mockSession.token }));
jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("./visit-card", () => ({
  VisitCard: ({ visit }: { visit: SharedVisit }) => {
    const { Text } = jest.requireActual("react-native");
    return <Text>{visit.venue.name}</Text>;
  },
}));
jest.mock("convex/react", () => ({
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
  mockSubscriptions.clear();
  mockDelivered = {};
  mockParams = {};
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

it("switches between loaded feeds without flashing loading placeholders", async () => {
  await render(<HomeScreen />);
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

it("retains loaded later pages separately for each feed", async () => {
  await render(<HomeScreen />);
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
  await render(<HomeScreen />);
  await deliver({ "sharedVisits:listFeed:first": page("Friends museum") });
  await fireEvent.press(screen.getByRole("button", { name: "Global" }));
  expect(screen.queryByText("Friends museum")).toBeNull();
  expect(screen.getByLabelText("Loading visits…")).toBeOnTheScreen();
  expect(screen.queryByText("No public visits yet.")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Friends" }));
  expect(screen.getByText("Friends museum")).toBeOnTheScreen();
});

it("clears both feeds when the account changes and gates Friends for guests", async () => {
  await render(<HomeScreen />);
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
  await render(<HomeScreen />);
  expect(screen.getByText("Sign in to connect with friends.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Friends" }));
  expect(screen.getByText("Sign in to connect with friends.")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Artlog" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Leaderboards" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Dismiss sign-in invitation" }));
  expect(screen.queryByText("Sign in to connect with friends.")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Global" }));
  expect(screen.queryByText("Sign in to connect with friends.")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Friends" }));
  expect(screen.queryByText("Sign in to connect with friends.")).toBeNull();
});

it("opens the requested feed after posting and still lets the user switch feeds", async () => {
  await render(<HomeScreen />);
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
