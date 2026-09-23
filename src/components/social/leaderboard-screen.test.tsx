import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import type { SocialSession } from "@/lib/social/use-social-session";
import { LeaderboardScreen } from "./leaderboard-screen";

jest.mock("@/lib/account/use-account", () => ({
  useAccount: () => ({ ready: true, available: false, busy: false }),
}));

const mockPush = jest.fn(),
  mockDismissAll = jest.fn(),
  mockChange = jest.fn(),
  mockRefresh = jest.fn(),
  mockQuery = jest.fn();
const mockSession = {
  status: "signed-out" as SocialSession["status"],
  key: "guest",
  profileId: undefined as Id<"profiles"> | undefined,
};
let mockVisibility = "off";
let mockRows = [
  {
    profile: { profileId: "global-person", name: "Ada", username: "ada", publishedWallCount: 2 },
    rank: 1,
    score: 4,
  },
];
const mockSettings = new Map<string, string>();
let mockSheetDismiss: (() => void) | undefined;

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@expo/ui/swift-ui", () => {
  const React = jest.requireActual("react"),
    { Pressable, Text, View } = jest.requireActual("react-native");
  return {
    ...jest.requireActual("@/__mocks__/@expo/ui/swift-ui"),
    Host: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    VStack: View,
    ScrollView: View,
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
    Picker: ({
      children,
      onSelectionChange,
    }: {
      children: ReactNode;
      onSelectionChange: (value: string) => void;
    }) => (
      <View>
        {React.Children.map(
          children,
          (child: {
            props: { children: string; modifiers: { $type: string; tag?: string }[] };
          }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Choose ${child.props.children}`}
              onPress={() =>
                onSelectionChange(
                  child.props.modifiers.find((modifier) => modifier.$type === "tag")?.tag ?? "",
                )
              }
            >
              <Text>{child.props.children}</Text>
            </Pressable>
          ),
        )}
      </View>
    ),
  };
});
jest.mock("expo-network", () => ({
  useNetworkState: () => ({ isConnected: true, isInternetReachable: true }),
}));
jest.mock("expo-router", () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    navigate: (...args: unknown[]) => mockPush(...args),
    dismissAll: () => mockDismissAll(),
  },
  useRouter: () => ({ push: mockPush }),
  Stack: { Screen: () => null, Toolbar: Object.assign(() => null, { Button: () => null }) },
}));
jest.mock("@/db/repos/settings", () => ({
  getSetting: async (key: string) => mockSettings.get(key),
  setSetting: async (key: string, value: string) => {
    mockSettings.set(key, value);
  },
}));
jest.mock("@/lib/social/use-social-session", () => ({ useSocialSession: () => mockSession }));
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
      loading: false,
      refresh: mockRefresh,
    };
  },
}));
jest.mock("convex/react", () => ({ useMutation: () => mockChange }));
jest.mock("../settings/account-section", () => ({ AccountSection: () => null }));

beforeEach(() => {
  jest.clearAllMocks();
  mockSettings.clear();
  mockChange.mockResolvedValue(null);
  mockSession.status = "signed-out";
  mockSession.key = "guest";
  mockSession.profileId = undefined;
  mockVisibility = "off";
  mockRows = [
    {
      profile: { profileId: "global-person", name: "Ada", username: "ada", publishedWallCount: 2 },
      rank: 1,
      score: 4,
    },
  ];
});

it("lets a guest move from the Friends prompt to Global rankings and open a public profile", async () => {
  await render(<LeaderboardScreen />);
  expect(
    screen.getByRole("header", { name: "Sign in to see friends’ rankings." }),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Browse Global" }));
  expect(mockQuery).toHaveBeenCalledWith("leaderboards:list", {
    audience: "global",
    metric: "visits",
    period: "month",
  });
  const row = screen.getByRole("button", { name: "Rank 1, Ada, 4 visits. Open public profile." });
  await fireEvent.press(row);
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/profile/[profileId]",
    params: { profileId: "global-person" },
  });
  expect(screen.getByRole("button", { name: "Join the leaderboard" })).toBeOnTheScreen();
});

it("changes category and period independently using the dropdowns", async () => {
  mockSession.status = "ready";
  await render(<LeaderboardScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Choose Artworks" }));
  await fireEvent.press(screen.getByRole("button", { name: "Choose All time" }));
  expect(mockQuery).toHaveBeenCalledWith("leaderboards:list", {
    audience: "friends",
    metric: "artworks",
    period: "all",
  });
  expect(mockSettings.get("leaderboard-choice")).toBe(
    '{"audience":"friends","metric":"artworks","period":"all"}',
  );
  expect(
    screen.getByRole("button", { name: "Rank 1, Ada, 4 artworks. Open public profile." }),
  ).toBeOnTheScreen();
});

it("asks an authenticated person without a profile to create one before viewing Friends rankings", async () => {
  mockSession.status = "profile-required";
  await render(<LeaderboardScreen />);
  expect(
    screen.getByRole("header", { name: "Create a profile to see friends’ rankings." }),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Create your profile" }));
  expect(mockPush).toHaveBeenCalledWith("/create-profile");
  expect(mockQuery).toHaveBeenCalledWith("leaderboards:list", "skip");
});

it("offers friend discovery when an authenticated person has no Friends rankings", async () => {
  mockSession.status = "ready";
  mockRows = [];
  await render(<LeaderboardScreen />);
  expect(
    screen.getByRole("header", { name: "No friends on this leaderboard yet." }),
  ).toBeOnTheScreen();
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
  await fireEvent.press(screen.getByRole("button", { name: "Manage participation" }));
  await fireEvent.press(screen.getByRole("button", { name: "Friends only" }));
  expect(mockChange).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  await act(() => mockSheetDismiss?.());
  expect(mockChange).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Manage participation" }));
  expect(screen.getByRole("button", { name: "Friends & Global" })).toBeSelected();
  await fireEvent.press(screen.getByRole("button", { name: "Off" }));
  await fireEvent.press(screen.getByRole("button", { name: "Save participation" }));
  expect(mockChange).toHaveBeenCalledWith({ visibility: "off" });
  await waitFor(() => expect(screen.queryByRole("header", { name: "Participation" })).toBeNull());
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
  await fireEvent.press(screen.getByRole("button", { name: "Save participation" }));
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
  await fireEvent.press(screen.getByRole("button", { name: "Save participation" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Could not save participation. Try again.");
  await fireEvent.press(screen.getByRole("button", { name: "Save participation" }));
  expect(mockChange).toHaveBeenLastCalledWith({ visibility: "global" });
});

it("offers creation for the selected metric while preserving actual participation", async () => {
  mockSession.status = "ready";
  mockVisibility = "global";
  mockRows = [];
  mockSettings.set(
    "leaderboard-choice",
    JSON.stringify({ audience: "global", metric: "visits", period: "month" }),
  );
  await render(<LeaderboardScreen />);
  expect(await screen.findByRole("button", { name: "Manage participation" })).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "No rankings this month." })).toBeOnTheScreen();
  await fireEvent.press(await screen.findByRole("button", { name: "Add visit" }));
  expect(mockPush).toHaveBeenLastCalledWith("/visit-create");
  expect(screen.queryByText("LOGGED VISITS")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Choose Artworks" }));
  await fireEvent.press(screen.getByRole("button", { name: "Scan artwork" }));
  expect(mockDismissAll).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenLastCalledWith("/scan");
  await fireEvent.press(screen.getByRole("button", { name: "Choose All time" }));
  expect(screen.getByRole("header", { name: "No rankings yet." })).toBeOnTheScreen();
});
