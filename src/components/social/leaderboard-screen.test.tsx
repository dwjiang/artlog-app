import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Alert, type AlertButton } from "react-native";

import { lastRefreshControl } from "@/components/pull-to-refresh.testing";
import type { SocialSession } from "@/lib/social/use-social-session";
import { dismissToast } from "@/lib/ui/toast";

import type { Id } from "../../../convex/_generated/dataModel";
import { LeaderboardScreen } from "./leaderboard-screen";

jest.mock("@/lib/account/use-account", () => ({
  useAccount: () => ({ ready: true, available: false, busy: false }),
}));

const mockPush = jest.fn();
const mockDismissAll = jest.fn();
const mockChange = jest.fn();
const mockRefresh = jest.fn();
const mockQuery = jest.fn();
const mockSession = {
  status: "signed-out" as SocialSession["status"],
  key: "guest",
  profileId: undefined as Id<"profiles"> | undefined,
};
let mockVisibility = "off";
let mockRefreshing = false;
let mockRows = [
  {
    profile: {
      profileId: "global-person",
      name: "Ada",
      username: "ada",
      publishedWallCount: 2,
    },
    rank: 1,
    score: 4,
  },
];
const mockSettings = new Map<string, string>();
let mockSheetDismiss: (() => void) | undefined;
let mockSheetModifiers: { $type: string; isDisabled?: boolean }[] = [];

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@expo/ui/swift-ui", () => {
  const { View } = jest.requireActual("react-native");
  return {
    ...jest.requireActual("@/__mocks__/@expo/ui/swift-ui"),
    Host: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    VStack: View,
    ScrollView: View,
    Group: ({ modifiers, children }: { modifiers: typeof mockSheetModifiers; children: ReactNode }) => {
      mockSheetModifiers = modifiers;
      return <View>{children}</View>;
    },
    BottomSheet: ({
      isPresented,
      onDismiss,
      children,
    }: {
      isPresented: boolean;
      onDismiss: () => void;
      children: ReactNode;
    }) => {
      mockSheetDismiss = onDismiss;
      return isPresented ? <View>{children}</View> : null;
    },
    Menu: ({ label, children }: { label: ReactNode; children: ReactNode }) => (
      <View>
        {label}
        {children}
      </View>
    ),
  };
});
jest.mock("expo-network", () => ({
  useNetworkState: () => ({ isConnected: true, isInternetReachable: true }),
}));
jest.mock("expo-router", () => {
  const { Pressable, View } = jest.requireActual("react-native");
  return {
    router: {
      push: (...args: unknown[]) => mockPush(...args),
      navigate: (...args: unknown[]) => mockPush(...args),
      dismissAll: () => mockDismissAll(),
    },
    useRouter: () => ({ push: mockPush }),
    useSegments: () => [],
    Stack: {
      Toolbar: Object.assign(View, {
        Button: ({
          accessibilityLabel,
          hidden,
          onPress,
        }: {
          accessibilityLabel: string;
          hidden?: boolean;
          onPress: () => void;
        }) =>
          hidden ? null : (
            <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} />
          ),
      }),
    },
  };
});
jest.mock("@/db/repos/settings", () => ({
  getSetting: async (key: string) => mockSettings.get(key),
  setSetting: async (key: string, value: string) => {
    mockSettings.set(key, value);
  },
}));
jest.mock("@/lib/social/use-social-session", () => ({
  useSocialSession: () => mockSession,
}));
jest.mock("@/lib/social/use-social-query", () => ({
  useSocialQuery: (query: unknown, args: unknown) => {
    const name = jest.requireActual("convex/server").getFunctionName(query);
    mockQuery(name, args);
    return {
      data:
        args === "skip"
          ? undefined
          : name === "leaderboards:preference"
            ? mockVisibility
            : { visibility: mockVisibility, rows: mockRows },
      loading: mockRefreshing,
      refreshing: mockRefreshing,
      refresh: mockRefresh,
    };
  },
}));
jest.mock("convex/react", () => ({ useMutation: () => mockChange }));
jest.mock("@/components/settings/account-section", () => ({
  AccountSection: () => null,
}));

beforeEach(() => {
  jest.clearAllMocks();
  dismissToast();
  mockSettings.clear();
  mockChange.mockResolvedValue(null);
  mockSession.status = "signed-out";
  mockSession.key = "guest";
  mockSession.profileId = undefined;
  mockVisibility = "off";
  mockRefreshing = false;
  mockRows = [
    {
      profile: {
        profileId: "global-person",
        name: "Ada",
        username: "ada",
        publishedWallCount: 2,
      },
      rank: 1,
      score: 4,
    },
  ];
});
afterEach(() => dismissToast());

it("lets a guest move from the Friends prompt to Global rankings and open a public profile", async () => {
  await render(<LeaderboardScreen />);
  expect(screen.getByRole("header", { name: "Sign in to see friends’ rankings." })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Join the leaderboard" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Browse Global" }));
  expect(mockQuery).toHaveBeenCalledWith("leaderboards:list", {
    audience: "global",
    metric: "visits",
  });
  const row = screen.getByRole("button", {
    name: "Rank 1, Ada, 4 visits. Open public profile.",
  });
  await fireEvent.press(row);
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/profile/[profileId]",
    params: { profileId: "global-person" },
  });
  expect(screen.getByRole("button", { name: "Join the leaderboard" })).toBeOnTheScreen();
});

it("keeps the ranking filter and participation action mounted across audiences", async () => {
  await render(<LeaderboardScreen />);
  const metric = screen.getByLabelText("Rank by");
  const participation = screen.getByRole("button", { name: "Join the leaderboard" });
  for (const name of ["Global", "Friends", "Global"]) {
    await fireEvent.press(screen.getByRole("button", { name }));
    expect(screen.getByLabelText("Rank by")).toBe(metric);
    expect(screen.getByRole("button", { name: "Join the leaderboard" })).toBe(participation);
  }
});

it("changes the ranking metric without time-period controls", async () => {
  mockSession.status = "ready";
  await render(<LeaderboardScreen />);
  expect(screen.queryByText("Time period")).toBeNull();
  expect(screen.queryByRole("button", { name: "This month" })).toBeNull();
  expect(screen.getByRole("button", { name: "Museum Visits" })).toBeSelected();
  await fireEvent.press(screen.getByRole("button", { name: "Artworks" }));
  expect(mockQuery).toHaveBeenCalledWith("leaderboards:list", {
    audience: "friends",
    metric: "artworks",
  });
  expect(mockSettings.get("leaderboard-choice")).toBe('{"audience":"friends","metric":"artworks"}');
  expect(
    screen.getByRole("button", {
      name: "Rank 1, Ada, 4 artworks. Open public profile.",
    }),
  ).toBeOnTheScreen();
});

it("asks an authenticated person without a profile to create one before viewing Friends rankings", async () => {
  mockSession.status = "profile-required";
  await render(<LeaderboardScreen />);
  expect(
    screen.getByRole("header", {
      name: "Create a profile to see friends’ rankings.",
    }),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Create your profile" }));
  expect(mockPush).toHaveBeenCalledWith("/create-profile");
  expect(mockQuery).toHaveBeenCalledWith("leaderboards:list", "skip");
});

it("offers friend discovery when an authenticated person has no Friends rankings", async () => {
  mockSession.status = "ready";
  mockRows = [];
  await render(<LeaderboardScreen />);
  expect(screen.getByRole("header", { name: "No friends on this leaderboard yet." })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Find friends" }));
  expect(mockPush).toHaveBeenCalledWith("/people");
});

it("opens sign-in when a guest joins the leaderboard", async () => {
  await render(<LeaderboardScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Global" }));
  await fireEvent.press(screen.getByRole("button", { name: "Join the leaderboard" }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/sign-in",
    params: { context: "leaderboards" },
  });
  expect(screen.queryByRole("header", { name: "Participation" })).toBeNull();
});

it("keeps Manage available with a ranking and only changes participation after Save", async () => {
  mockSession.status = "ready";
  mockSession.profileId = "global-person" as Id<"profiles">;
  mockVisibility = "global";
  await render(<LeaderboardScreen />);
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  await fireEvent.press(screen.getByRole("button", { name: "Manage participation" }));
  await fireEvent.press(screen.getByRole("button", { name: "Friends only" }));
  expect(mockChange).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  const [, , buttons] = alert.mock.lastCall as [string, undefined, AlertButton[]];
  await act(() => buttons.find((button) => button.text === "Discard Edits")?.onPress?.());
  await act(() => mockSheetDismiss?.());
  expect(mockChange).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Manage participation" }));
  expect(screen.getByRole("button", { name: "Friends & Global" })).toBeSelected();
  await fireEvent.press(screen.getByRole("button", { name: "Off" }));
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  expect(mockChange).toHaveBeenCalledWith({ visibility: "off" });
  await waitFor(() => expect(screen.queryByRole("header", { name: "Participation" })).toBeNull());
});

it("asks before Cancel drops a changed participation choice, and holds the sheet against a swipe", async () => {
  mockSession.status = "ready";
  mockVisibility = "global";
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  const swipeLocked = () =>
    mockSheetModifiers.some((modifier) => modifier.$type === "interactiveDismissDisabled" && modifier.isDisabled);
  await render(<LeaderboardScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Manage participation" }));
  expect(swipeLocked()).toBe(false);
  await fireEvent.press(screen.getByRole("button", { name: "Off" }));
  expect(swipeLocked()).toBe(true);
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(alert).toHaveBeenCalledWith("Discard your edits?", undefined, expect.any(Array));
  const [, , buttons] = alert.mock.lastCall as [string, undefined, AlertButton[]];
  await act(() => buttons.find((button) => button.text === "Keep Editing")?.onPress?.());
  expect(screen.getByRole("button", { name: "Off" })).toBeSelected();

  // Choosing the saved audience again leaves nothing to discard.
  alert.mockClear();
  await fireEvent.press(screen.getByRole("button", { name: "Friends & Global" }));
  expect(swipeLocked()).toBe(false);
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(alert).not.toHaveBeenCalled();
  await act(() => mockSheetDismiss?.());
  expect(screen.queryByRole("header", { name: "Participation" })).toBeNull();
  alert.mockRestore();
});

it("holds Cancel while a participation save is pending so a dismissed sheet never outlives its screen state", async () => {
  mockSession.status = "ready";
  let finish!: () => void;
  mockChange.mockReturnValueOnce(
    new Promise<null>((resolve) => {
      finish = () => resolve(null);
    }),
  );
  await render(<LeaderboardScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Join the leaderboard" }));
  await fireEvent.press(screen.getByRole("button", { name: "Friends only" }));
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await act(async () => {
    finish();
  });
  await waitFor(() => expect(screen.queryByRole("header", { name: "Participation" })).toBeNull());
  await fireEvent.press(screen.getByRole("button", { name: "Join the leaderboard" }));
  expect(screen.getByRole("header", { name: "Participation" })).toBeOnTheScreen();
});

it("keeps a failed participation change available for retry", async () => {
  mockSession.status = "ready";
  mockChange.mockRejectedValueOnce(new Error("offline"));
  await render(<LeaderboardScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Join the leaderboard" }));
  await fireEvent.press(screen.getByRole("button", { name: "Friends & Global" }));
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t save participation.");
  await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
  expect(mockChange).toHaveBeenLastCalledWith({ visibility: "global" });
});

it("clears an outdated retry when the participation audience changes", async () => {
  mockSession.status = "ready";
  mockChange.mockRejectedValueOnce(new Error("offline"));
  await render(<LeaderboardScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Join the leaderboard" }));
  await fireEvent.press(screen.getByRole("button", { name: "Friends & Global" }));
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByRole("button", { name: "Retry" })).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole("button", { name: "Friends only" }));
  expect(screen.getByRole("button", { name: "Friends only" })).toBeSelected();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(mockChange).toHaveBeenCalledTimes(1);

  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  expect(mockChange).toHaveBeenLastCalledWith({ visibility: "friends" });
});

it("offers creation for the selected metric while preserving actual participation", async () => {
  mockSession.status = "ready";
  mockVisibility = "global";
  mockRows = [];
  mockSettings.set("leaderboard-choice", JSON.stringify({ audience: "global", metric: "visits" }));
  await render(<LeaderboardScreen />);
  expect(await screen.findByRole("button", { name: "Manage participation" })).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "No rankings yet." })).toBeOnTheScreen();
  await fireEvent.press(await screen.findByRole("button", { name: "Add visit" }));
  expect(mockPush).toHaveBeenLastCalledWith("/visit-add");
  expect(screen.queryByText("LOGGED VISITS")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Artworks" }));
  await fireEvent.press(screen.getByRole("button", { name: "Scan artwork" }));
  expect(mockDismissAll).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenLastCalledWith("/scan");
  expect(screen.getByRole("header", { name: "No rankings yet." })).toBeOnTheScreen();
});

it("refreshes the board when pulled and keeps an empty board's message while it reloads", async () => {
  mockSession.status = "ready";
  mockRows = [];
  const view = await render(<LeaderboardScreen />);
  await act(() => lastRefreshControl().onRefresh?.());
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  mockRefreshing = true;
  await view.rerender(<LeaderboardScreen />);
  expect(lastRefreshControl().refreshing).toBe(true);
  expect(screen.getByText("No friends on this leaderboard yet.")).toBeOnTheScreen();
  expect(screen.queryByLabelText("Opening leaderboard…")).toBeNull();
});
