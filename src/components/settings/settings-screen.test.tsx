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
let mockAccount:
  | { linked: boolean; deviceCount: number; email?: string; safetyChecks?: boolean | null }
  | null
  | undefined = null;
let mockBusy = false;
let mockSessionStatus = "ready";
let mockOffline = false;
let mockSafetyChecks = false;
const mockSetSafetyChecks = jest.fn(async () => true);

jest.mock("./leaderboard-preference", () => ({
  LeaderboardPreference: () => null,
}));
jest.mock("@/lib/social/use-social-session", () => ({
  useSocialSession: () => ({
    status: mockSessionStatus,
    key: "settings",
    offline: mockOffline,
    accountReady: !mockOffline && (mockSessionStatus === "ready" || mockSessionStatus === "profile-required"),
    safetyChecks: mockSafetyChecks,
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
  useMutation: () => mockSetSafetyChecks,
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
  mockSafetyChecks = false;
  process.env.EXPO_PUBLIC_CONVEX_SITE_URL = "https://test.convex.site";
});

it("shows grouped settings and opens the matching detail", async () => {
  await render(<SettingsScreen />);
  expect(screen.getByRole("button", { name: "Sign in" })).toBeOnTheScreen();
  expect(screen.queryByText("YA", { includeHiddenElements: true })).toBeNull();
  for (const title of ["App", "Legal", "Support", "Developer"]) {
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

it("lets a guest delete their data from the account page behind their collection card", async () => {
  mockAccount = { linked: false, deviceCount: 0 };
  await render(<SettingsScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Your collection" }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/settings-detail", params: { section: "account" } });
  await render(<SettingsDetailScreen section="account" />);
  await fireEvent.press(screen.getByRole("button", { name: "Delete my data" }));
  expect(mockDelete).not.toHaveBeenCalled();
  await confirmDestructive();
  expect(mockDelete).toHaveBeenCalledTimes(1);
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
  await fireEvent.press(screen.getByRole("button", { name: "Delete account" }));
  await confirmDestructive();
  expect(mockDelete).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
  expect(mockSignOut).not.toHaveBeenCalled();
  await confirmDestructive();
  expect(mockSignOut).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "Edit Profile" }));
  expect(mockPush).toHaveBeenLastCalledWith("/edit-profile");
});

it("turns safety checks on after naming OpenAI, and confirms before turning them off", async () => {
  mockAccount = { linked: true, deviceCount: 1, safetyChecks: false };
  const view = await render(<SettingsDetailScreen section="account" />);
  expect(
    screen.getByText(
      /^Our moderation provider, OpenAI, checks your comments, visit notes and bio .* you can’t post them\.$/,
    ),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("switch", { name: "Safety checks" }));
  const [title, message, buttons] = jest.mocked(Alert.alert).mock.calls.at(-1)!;
  expect([title, message]).toEqual([
    "Turn on safety checks?",
    "Our moderation provider, OpenAI, checks your comments, visit notes and bio for harmful content before others see them. It gets only the text, not your name or account.",
  ]);
  await act(() => buttons?.find((button) => button.text === "Turn On")?.onPress?.());
  expect(mockSetSafetyChecks).toHaveBeenLastCalledWith({ enabled: true });

  mockSafetyChecks = true;
  mockAccount.safetyChecks = true;
  await view.rerender(<SettingsDetailScreen section="account" />);
  expect(screen.getByRole("switch", { name: "Safety checks" })).toBeChecked();
  await fireEvent.press(screen.getByRole("switch", { name: "Safety checks" }));
  expect(jest.mocked(Alert.alert).mock.calls.at(-1)?.[0]).toBe("Turn off safety checks?");
  await confirmDestructive();
  expect(mockSetSafetyChecks).toHaveBeenLastCalledWith({ enabled: false });
});

it.each([true, false])(
  "keeps the saved safety-checks value %s while offline and resumes on reconnect",
  async (enabled) => {
    mockAccount = { linked: true, deviceCount: 1, safetyChecks: enabled };
    mockSafetyChecks = enabled;
    const view = await render(<SettingsDetailScreen section="account" />);
    expect(screen.getByRole("switch", { name: "Safety checks" })).toBeEnabled();

    mockOffline = true;
    mockSessionStatus = "offline";
    mockSafetyChecks = false;
    await view.rerender(<SettingsDetailScreen section="account" />);
    const toggle = screen.getByRole("switch", { name: "Safety checks", checked: enabled });
    expect(toggle).toBeDisabled();
    await fireEvent.press(toggle);
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockSetSafetyChecks).not.toHaveBeenCalled();

    mockOffline = false;
    mockSessionStatus = "ready";
    mockAccount.safetyChecks = !enabled;
    mockSafetyChecks = !enabled;
    await view.rerender(<SettingsDetailScreen section="account" />);
    expect(screen.getByRole("switch", { name: "Safety checks", checked: !enabled })).toBeEnabled();
  },
);

it("keeps known consent visible but disables changes while the account session is loading", async () => {
  mockAccount = { linked: true, deviceCount: 1, safetyChecks: true };
  mockSessionStatus = "loading";
  await render(<SettingsDetailScreen section="account" />);
  const toggle = screen.getByRole("switch", { name: "Safety checks", checked: true });
  expect(toggle).toBeDisabled();
  await fireEvent.press(toggle);
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(mockSetSafetyChecks).not.toHaveBeenCalled();
});

it("disables safety-check changes until the current choice finishes saving", async () => {
  mockAccount = { linked: true, deviceCount: 1, safetyChecks: false };
  let finish!: (enabled: boolean) => void;
  mockSetSafetyChecks.mockReturnValueOnce(new Promise<boolean>((resolve) => (finish = resolve)));
  await render(<SettingsDetailScreen section="account" />);
  await fireEvent.press(screen.getByRole("switch", { name: "Safety checks" }));
  await act(() =>
    jest
      .mocked(Alert.alert)
      .mock.calls.at(-1)?.[2]
      ?.find((button) => button.text === "Turn On")
      ?.onPress?.(),
  );
  expect(screen.getByRole("switch", { name: "Safety checks" })).toBeDisabled();
  await act(() => finish(true));
  expect(screen.getByRole("switch", { name: "Safety checks" })).toBeEnabled();
});

it("offers profile creation from account settings when the account has no profile yet", async () => {
  mockAccount = { linked: true, deviceCount: 1, email: "visitor@example.com" };
  mockSessionStatus = "profile-required";
  await render(<SettingsDetailScreen section="account" />);
  expect(screen.queryByRole("button", { name: "Edit Profile" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Create Profile" }));
  expect(mockPush).toHaveBeenLastCalledWith("/create-profile");
});
