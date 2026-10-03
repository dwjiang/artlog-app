import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Alert } from "react-native";

import { SettingsDetailScreen } from "./settings-detail-screen";
import { SettingsScreen } from "./settings-screen";

const mockPush = jest.fn();
const mockOpenBrowser = jest.fn();
const mockSignOut = jest.fn();
const mockSignIn = jest.fn();
const mockDelete = jest.fn();
let mockAccount: { linked: boolean; deviceCount: number; email?: string } | null | undefined = null;
let mockBusy = false;
let mockSessionStatus = "ready";
let mockOffline = false;

jest.mock("./leaderboard-preference", () => ({
  LeaderboardPreference: () => null,
}));
jest.mock("@/lib/social/use-social-session", () => ({
  useSocialSession: () => ({
    status: mockSessionStatus,
    key: "settings",
    offline: mockOffline,
  }),
}));
jest.mock("@/lib/social/use-social-query", () => ({
  useSocialQuery: () => ({
    data: mockAccount?.linked ? { name: "Alex", username: "alex" } : undefined,
  }),
}));
jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
jest.mock("@/hooks/use-screen-active", () => ({ useScreenActive: () => true }));
jest.mock("./dev-tools", () => ({ DevTools: () => null }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: (url: string) => mockOpenBrowser(url) }));

jest.mock("@/lib/account/use-account", () => ({
  useAccount: () => ({
    account: mockAccount,
    available: true,
    busy: mockBusy,
    ready: true,
    signOut: mockSignOut,
    signInWithApple: mockSignIn,
    deleteAccount: mockDelete,
  }),
}));
jest.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true }),
  useMutation: () => jest.fn(),
  useQuery: (fn: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    const name = jest.requireActual("convex/server").getFunctionName(fn);
    if (name === "health:ping") return { modelVersion: "test" };
    return undefined;
  },
}));
jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  Stack: { Screen: () => null },
  Link: ({ children }: { children: ReactNode }) => children,
}));

async function confirmDestructive() {
  const button = jest
    .mocked(Alert.alert)
    .mock.calls.at(-1)?.[2]
    ?.find((entry) => entry.style === "destructive");
  expect(button).toBeDefined();
  await act(() => button?.onPress?.());
}
beforeEach(async () => {
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  jest.clearAllMocks();
  mockAccount = null;
  mockBusy = false;
  mockSessionStatus = "ready";
  mockOffline = false;
  process.env.EXPO_PUBLIC_CONVEX_SITE_URL = "https://test.convex.site";
});

it("shows grouped settings and opens the matching detail", async () => {
  await render(<SettingsScreen />);
  expect(screen.getByRole("button", { name: "Sign in" })).toBeOnTheScreen();
  expect(screen.queryByText("YA", { includeHiddenElements: true })).toBeNull();
  for (const title of ["Settings", "App", "Legal", "Support", "Developer"]) {
    expect(screen.getByRole("header", { name: title })).toBeOnTheScreen();
  }
  expect(screen.queryByRole("button", { name: "Export journal" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Contributions" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Visits" })).toBeNull();
  for (const [label, section] of [
    ["General", "general"],
    ["About", "about"],
  ]) {
    await fireEvent.press(screen.getByRole("button", { name: label }));
    expect(mockPush).toHaveBeenLastCalledWith({
      pathname: "/settings-detail",
      params: { section },
    });
  }
  await fireEvent.press(screen.getByRole("button", { name: "Privacy Policy" }));
  expect(mockOpenBrowser).toHaveBeenLastCalledWith("https://test.convex.site/privacy");
  await fireEvent.press(screen.getByRole("button", { name: "Terms of Service" }));
  expect(mockOpenBrowser).toHaveBeenLastCalledWith("https://test.convex.site/terms");
  await fireEvent.press(screen.getByRole("button", { name: "Widgets" }));
  expect(mockPush).toHaveBeenLastCalledWith("/widgets");
  await fireEvent.press(screen.getByRole("button", { name: "Send feedback" }));
  expect(mockPush).toHaveBeenLastCalledWith("/send-feedback");
});

it("opens measurement units in General", async () => {
  await render(<SettingsDetailScreen section="general" />);
  expect(screen.getByRole("header", { name: "Measurement units" })).toBeOnTheScreen();
  expect(await screen.findByRole("button", { name: "Metric", selected: true })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Imperial" })).toBeOnTheScreen();
});

it("opens account management from the profile row", async () => {
  mockAccount = { linked: true, deviceCount: 2 };
  await render(<SettingsScreen />);
  expect(screen.queryByRole("button", { name: "Export journal" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Public notes" })).toBeNull();
  expect(screen.getByText("A", { includeHiddenElements: true })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: /Alex/ }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/settings-detail",
    params: { section: "account" },
  });
});

it("keeps About details accessible", async () => {
  await render(<SettingsDetailScreen section="about" />);
  expect(screen.getByRole("header", { name: "Artlog" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Source code" })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Send feedback" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Open source licenses" }));
  expect(mockOpenBrowser).toHaveBeenLastCalledWith("https://test.convex.site/licenses");
});

it("opens contextual sign-in while keeping the guest journal available", async () => {
  await render(<SettingsScreen />);
  expect(screen.getByText("Saved on this iPhone")).toBeOnTheScreen();
  expect(screen.queryByText(/sync across devices/i)).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
  expect(mockSignIn).not.toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/sign-in",
    params: { context: "account" },
  });
});

it("holds the account row behind a ghost only while the account can still load", async () => {
  mockAccount = undefined;
  const view = await render(<SettingsDetailScreen section="account" />);
  expect(screen.getByRole("progressbar", { name: "Loading account" })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Sign in to Artlog" })).toBeNull();
  mockOffline = true;
  await view.rerender(<SettingsDetailScreen section="account" />);
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.getByRole("button", { name: "Sign in to Artlog" })).toBeEnabled();
});

it("shows account details and controls without device counts or sync copy", async () => {
  mockAccount = { linked: true, deviceCount: 2, email: "visitor@example.com" };
  await render(<SettingsDetailScreen section="account" />);
  expect(screen.queryByText("Devices")).toBeNull();
  expect(screen.queryByText(/devices|sync privately/i)).toBeNull();
  expect(screen.getByText("visitor@example.com")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Delete account" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
  expect(mockSignOut).not.toHaveBeenCalled();
  await confirmDestructive();
  expect(mockSignOut).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "Edit profile" }));
  expect(mockPush).toHaveBeenLastCalledWith("/edit-profile");
});

it("offers profile creation from account settings when the account has no profile yet", async () => {
  mockAccount = { linked: true, deviceCount: 1, email: "visitor@example.com" };
  mockSessionStatus = "profile-required";
  await render(<SettingsDetailScreen section="account" />);
  expect(screen.queryByRole("button", { name: "Edit profile" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Create profile" }));
  expect(mockPush).toHaveBeenLastCalledWith("/create-profile");
});
