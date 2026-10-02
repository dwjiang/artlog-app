import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import * as settings from "@/db/repos/settings";
import * as localProfile from "@/lib/account/local-profile";
import { getLocalProfileName, setLocalProfileName } from "@/lib/account/local-profile";
import { anonymousOwner, switchOwner } from "@/lib/account/owner-store";
import { offerProfileSetup, takeProfileSetupOffer } from "@/lib/account/profile-setup-offer";
import { reportError } from "@/lib/observability";
import { chooseProfilePhoto } from "@/lib/social/profile-photo";

import { ProfileSetupPrompt } from "./profile-setup-prompt";
import { WelcomeScreen } from "./welcome-screen";

type Permission = { granted: boolean; canAskAgain: boolean } | null;

const mockBack = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockSignInWithApple = jest.fn();
let mockAccount = {
  account: { linked: false, accountId: "account-a", hasProfile: false } as
    | { linked: boolean; accountId: string; hasProfile: boolean }
    | undefined,
  available: true,
  googleAvailable: true,
  busy: false,
  error: undefined as string | undefined,
  ready: true,
  signInWithApple: mockSignInWithApple,
  signInWithGoogle: jest.fn(),
};
const mockRequestCamera = jest.fn();
const mockRequestPhotos = jest.fn();
const mockRequestLocation = jest.fn();
let mockCamera = { hasPermission: false, canRequestPermission: true };
let mockPhotos: Permission = null;
let mockLocation: Permission = null;
jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, replace: mockReplace }),
  router: { push: (href: unknown) => mockPush(href) },
  usePathname: () => "/welcome",
}));
jest.mock("convex/react", () => ({
  useQuery: (_query: unknown, args: unknown) => (args === "skip" ? undefined : mockAccount.account),
}));
jest.mock("@/lib/use-device-ready", () => ({ useDeviceReady: () => true }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
jest.mock("react-native-worklets", () => jest.requireActual("react-native-worklets/lib/module/mock"));
jest.mock("react-native-reanimated", () => ({
  ...jest.requireActual("react-native-reanimated/mock"),
  cubicBezier: () => "ease-out",
  useReducedMotion: () => false,
}));
jest.mock("react-native-vision-camera", () => ({
  useCameraPermission: () => ({ ...mockCamera, requestPermission: mockRequestCamera }),
}));
jest.mock("expo-media-library", () => ({
  usePermissions: () => [mockPhotos, mockRequestPhotos],
}));
jest.mock("expo-location", () => ({
  useForegroundPermissions: () => [mockLocation, mockRequestLocation],
}));
jest.mock("@/lib/account/use-account", () => ({
  useAccount: () => mockAccount,
}));
jest.mock("expo-network", () => ({
  useNetworkState: () => ({ isConnected: true, isInternetReachable: true }),
}));
jest.mock("@/lib/social/profile-photo", () => ({
  chooseProfilePhoto: jest.fn(),
  removeProfilePhotoDraft: jest.fn(),
}));

const allowed = { granted: true, canAskAgain: true };

/** Declines every permission and the sign-in, which leaves a guest on the name page. */
async function declineEveryPermission() {
  await fireEvent.press(screen.getByRole("button", { name: "Get started" }));
  for (let page = 0; page < 4; page++) {
    await fireEvent.press(screen.getByRole("button", { name: "Not now" }));
  }
}

beforeEach(async () => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  await settings.removeSetting("local-profile-name");
  await settings.removeSetting("welcome-seen");
  mockCamera = { hasPermission: false, canRequestPermission: true };
  mockPhotos = null;
  mockLocation = null;
  mockRequestCamera.mockResolvedValue(true);
  mockRequestPhotos.mockResolvedValue(allowed);
  mockRequestLocation.mockResolvedValue(allowed);
  switchOwner(anonymousOwner());
  takeProfileSetupOffer();
  mockAccount = {
    ...mockAccount,
    account: { linked: false, accountId: "account-a", hasProfile: false },
    busy: false,
  };
});

it("asks for each permission before saving a name and completing onboarding", async () => {
  await render(<WelcomeScreen />);
  expect(screen.getByLabelText("Page 1 of 6")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: /Welcome to Artlog/ })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  expect(screen.getByText("The Starry Night")).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole("button", { name: "Get started" }));
  expect(screen.getByLabelText("Page 2 of 6")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Scan artworks." })).toBeOnTheScreen();
  expect(screen.getByText("Identifies paintings and reads their wall labels.")).toBeOnTheScreen();
  expect(screen.queryByRole("header", { name: /Welcome to Artlog/ })).toBeNull();

  await fireEvent.press(screen.getByRole("button", { name: "Allow camera" }));
  expect(mockRequestCamera).toHaveBeenCalledTimes(1);
  expect(await screen.findByLabelText("Page 3 of 6")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Keep the photo." })).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole("button", { name: "Not now" }));
  expect(mockRequestPhotos).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Page 4 of 6")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Find the museum." })).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole("button", { name: "Allow location" }));
  expect(mockRequestLocation).toHaveBeenCalledTimes(1);
  expect(await screen.findByLabelText("Page 5 of 6")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Save your collection." })).toBeOnTheScreen();
  expect(screen.getByText("Sync your collection, share your wall, and connect with friends.")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Continue with Apple" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Not now" }));
  expect(screen.getByLabelText("Page 6 of 6")).toBeOnTheScreen();
  expect(mockBack).not.toHaveBeenCalled();
  expect(await settings.getSetting("welcome-seen")).toBeUndefined();
  await fireEvent.changeText(screen.getByLabelText("Name"), "  Alex Rivera  ");
  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  expect(await getLocalProfileName()).toBe("Alex Rivera");
  expect(await settings.getSetting("welcome-seen")).toBe("true");
});

it("declines every permission but still requires a name or nickname", async () => {
  await render(<WelcomeScreen />);
  await declineEveryPermission();
  expect(screen.getByRole("header", { name: "Your name." })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText("Name"), "   ");
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  await fireEvent(screen.getByLabelText("Name"), "submitEditing");
  expect(mockBack).not.toHaveBeenCalled();
  expect(await getLocalProfileName()).toBeUndefined();
  expect(mockRequestCamera).not.toHaveBeenCalled();
  expect(mockRequestPhotos).not.toHaveBeenCalled();
  expect(mockRequestLocation).not.toHaveBeenCalled();
});

it("goes back one page at a time without answering for the visitor", async () => {
  await render(<WelcomeScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Get started" }));
  await fireEvent.press(screen.getByRole("button", { name: "Not now" }));
  expect(screen.getByRole("header", { name: "Keep the photo." })).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByLabelText("Page 2 of 6")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Allow camera" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("header", { name: /Welcome to Artlog/ })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  expect(mockRequestCamera).not.toHaveBeenCalled();
});

it("moves on without asking again when a permission is already answered", async () => {
  mockCamera = { hasPermission: false, canRequestPermission: false };
  await render(<WelcomeScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Get started" }));
  expect(screen.queryByRole("button", { name: "Not now" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  expect(mockRequestCamera).not.toHaveBeenCalled();
  expect(await screen.findByLabelText("Page 3 of 6")).toBeOnTheScreen();
});

it("prefills the saved name when onboarding is reopened", async () => {
  await setLocalProfileName("Alex");
  await render(<WelcomeScreen />);
  await declineEveryPermission();
  expect(await screen.findByDisplayValue("Alex")).toBeOnTheScreen();
});

it("keeps the entered name and retries when saving fails", async () => {
  const failure = new Error("Disk unavailable");
  jest.spyOn(settings, "setSetting").mockRejectedValueOnce(failure);
  await render(<WelcomeScreen />);
  await declineEveryPermission();
  await fireEvent.changeText(screen.getByLabelText("Name"), "Alex");
  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your name couldn’t be saved. Please try again.");
  expect(screen.getByDisplayValue("Alex")).toBeOnTheScreen();
  expect(mockBack).not.toHaveBeenCalled();
  expect(await settings.getSetting("welcome-seen")).toBeUndefined();
  expect(reportError).toHaveBeenCalledWith(failure, "account.welcome.save");
  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  expect(await getLocalProfileName()).toBe("Alex");
});

/** Reaches the sign-in page, signs in with Apple, and reports the linked account the way the account hook does. */
async function signInDuringOnboarding(hasProfile: boolean) {
  const tree = () => (
    <>
      <ProfileSetupPrompt />
      <WelcomeScreen />
    </>
  );
  const view = await render(tree());
  await fireEvent.press(screen.getByRole("button", { name: "Get started" }));
  for (let page = 0; page < 3; page++) {
    await fireEvent.press(screen.getByRole("button", { name: "Not now" }));
  }
  await fireEvent.press(screen.getByRole("button", { name: "Continue with Apple" }));
  expect(mockSignInWithApple).toHaveBeenCalledTimes(1);
  mockAccount = { ...mockAccount, busy: true };
  await view.rerender(tree());
  mockAccount = { ...mockAccount, account: { linked: true, accountId: "account-a", hasProfile } };
  await act(() => offerProfileSetup({ name: "Alex" }));
  mockAccount = { ...mockAccount, busy: false };
  await view.rerender(tree());
}

it("closes onboarding without a name page when an existing account signs in", async () => {
  await signInDuringOnboarding(true);
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  expect(mockReplace).not.toHaveBeenCalled();
  expect(await settings.getSetting("welcome-seen")).toBe("true");
  expect(await getLocalProfileName()).toBeUndefined();
});

it("continues a new account from onboarding into profile setup", async () => {
  await signInDuringOnboarding(false);
  await waitFor(() =>
    expect(mockReplace).toHaveBeenCalledWith({ pathname: "/create-profile", params: { name: "Alex" } }),
  );
  expect(mockBack).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
  expect(await settings.getSetting("welcome-seen")).toBe("true");
});

it("takes a signed-in account through the permissions only", async () => {
  switchOwner("account:alex");
  await render(<WelcomeScreen />);
  expect(screen.getByLabelText("Page 1 of 4")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Get started" }));
  for (let page = 0; page < 3; page++) {
    await fireEvent.press(screen.getByRole("button", { name: "Not now" }));
  }
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("header", { name: "Save your collection." })).toBeNull();
  expect(await settings.getSetting("welcome-seen")).toBe("true");
});

it("saves a chosen photo with the name, and keeps the name page usable when Photos fails", async () => {
  const savePhoto = jest.spyOn(localProfile, "setLocalProfilePhoto").mockResolvedValue();
  const failure = new Error("Picker unavailable");
  jest.mocked(chooseProfilePhoto).mockRejectedValueOnce(failure).mockResolvedValueOnce("file:///cache/me.jpg");
  await render(<WelcomeScreen />);
  await declineEveryPermission();

  await fireEvent.press(screen.getByRole("button", { name: "Add a photo" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("This photo couldn’t be opened. Choose another.");
  expect(reportError).toHaveBeenCalledWith(failure, "account.welcome.photo");

  await fireEvent.press(screen.getByRole("button", { name: "Add a photo" }));
  expect(await screen.findByRole("button", { name: "Change photo" })).toBeOnTheScreen();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(savePhoto).not.toHaveBeenCalled();

  await fireEvent.changeText(screen.getByLabelText("Name"), "Alex");
  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  expect(savePhoto).toHaveBeenCalledWith("file:///cache/me.jpg");
  expect(await getLocalProfileName()).toBe("Alex");
});
