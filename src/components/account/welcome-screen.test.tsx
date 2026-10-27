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
const mockOpenBrowser = jest.fn();
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
const mockConvexMutation = jest.fn<Promise<boolean>, unknown[]>(async () => true);
jest.mock("@/lib/convex-client", () => ({
  convex: { mutation: (...args: unknown[]) => mockConvexMutation(...args) },
}));
jest.mock("expo-audio", () => ({
  useAudioPlayer: () => ({ pause: () => {} }),
  useAudioPlayerStatus: () => ({ playing: false, currentTime: 0 }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("react-native-worklets", () => jest.requireActual("react-native-worklets/lib/module/mock"));
jest.mock("react-native-reanimated", () => ({
  ...jest.requireMock("react-native-reanimated/mock"),
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
jest.mock("expo-web-browser", () => ({ openBrowserAsync: (url: string) => mockOpenBrowser(url) }));
jest.mock("@/lib/social/profile-photo", () => ({
  chooseProfilePhoto: jest.fn(),
  removeProfilePhotoDraft: jest.fn(),
}));

const allowed = { granted: true, canAskAgain: true };
const declined = { granted: false, canAskAgain: false };

/** Continues through a guest's three permission pages, each raising its iPhone prompt, and allows safety checks. */
async function continueThroughPermissions() {
  for (let page = 1; page <= 3; page++) {
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByLabelText(`Step ${page + 1} of 6`)).toBeOnTheScreen();
  }
  await fireEvent.press(screen.getByRole("button", { name: "Allow" }));
  expect(await screen.findByLabelText("Step 5 of 6")).toBeOnTheScreen();
}

/** Answers every iPhone prompt and skips the sign-in, which leaves a guest on the name page. */
async function reachNamePage() {
  await fireEvent.press(screen.getByRole("button", { name: "Get started" }));
  await continueThroughPermissions();
  await fireEvent.press(screen.getByRole("button", { name: "Not Now" }));
}

beforeEach(async () => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  mockConvexMutation.mockReset().mockResolvedValue(true);
  await settings.removeSetting("safety-checks");
  await settings.removeSetting("local-profile-name");
  await settings.setSetting("local-profile-avatar", "vermeer");
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

it("raises each iPhone prompt before saving a name and completing onboarding", async () => {
  mockRequestPhotos.mockResolvedValue(declined);
  await render(<WelcomeScreen />);
  expect(screen.queryByLabelText(/^Step /)).toBeNull();
  expect(screen.getByRole("header", { name: /Welcome to Artlog/ })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  expect(screen.getByText("Washington Crossing the Delaware")).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole("button", { name: "Get started" }));
  expect(screen.getByLabelText("Step 1 of 6")).toBeOnTheScreen();
  // Artlog's icon linked to the permission's own makes each page read as a permission request.
  expect(screen.getByRole("image", { name: "Camera permission" })).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Scan artworks." })).toBeOnTheScreen();
  expect(screen.getByText("Identifies paintings and reads their wall labels.")).toBeOnTheScreen();
  expect(screen.getByText("Only used while Artlog is open.")).toBeOnTheScreen();
  expect(screen.queryByRole("header", { name: /Welcome to Artlog/ })).toBeNull();
  // App Review rejects pre-prompts that say "Allow" or offer a way past the iPhone prompt.
  expect(screen.queryByRole("button", { name: /^(Allow|Not Now)/ })).toBeNull();

  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  expect(mockRequestCamera).toHaveBeenCalledTimes(1);
  expect(await screen.findByLabelText("Step 2 of 6")).toBeOnTheScreen();
  expect(screen.getByRole("image", { name: "Photos permission" })).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Keep the photo." })).toBeOnTheScreen();
  expect(screen.getByText("Artlog can’t see your other photos.")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: /^(Allow|Not Now)/ })).toBeNull();

  // Declining the iPhone prompt still moves on.
  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  expect(mockRequestPhotos).toHaveBeenCalledTimes(1);
  expect(await screen.findByLabelText("Step 3 of 6")).toBeOnTheScreen();
  expect(screen.getByRole("image", { name: "Location permission" })).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Find the museum." })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: /^(Allow|Not Now)/ })).toBeNull();

  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  expect(mockRequestLocation).toHaveBeenCalledTimes(1);
  // No iPhone prompt follows the safety-checks page, so it asks itself and names who gets the text.
  expect(await screen.findByLabelText("Step 4 of 6")).toBeOnTheScreen();
  expect(screen.getByRole("image", { name: "Safety checks permission" })).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Keep posts safe." })).toBeOnTheScreen();
  expect(screen.getByText(/Our moderation provider, OpenAI, checks your comments/)).toBeOnTheScreen();
  expect(screen.getByText("It gets only the text, not your name or account.")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Allow" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Don’t Allow" }));
  expect(await screen.findByLabelText("Step 5 of 6")).toBeOnTheScreen();
  expect(await settings.getSetting("safety-checks")).toBe("off");
  expect(mockConvexMutation).not.toHaveBeenCalled();
  expect(screen.getByRole("header", { name: "Save your collection." })).toBeOnTheScreen();
  expect(screen.getByText("Sync your collection, share your wall, and connect with friends.")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Continue with Apple" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Not Now" }));
  expect(screen.getByLabelText("Step 6 of 6")).toBeOnTheScreen();
  expect(mockBack).not.toHaveBeenCalled();
  expect(await settings.getSetting("welcome-seen")).toBeUndefined();
  await fireEvent.changeText(screen.getByLabelText("Name"), "  Alex Rivera  ");
  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  expect(await getLocalProfileName()).toBe("Alex Rivera");
  expect(await settings.getSetting("welcome-seen")).toBe("true");
});

it("opens the terms and privacy policy websites from the first page", async () => {
  await render(<WelcomeScreen />);
  expect(screen.getByText(/By continuing, you agree to our Terms of Service/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("link", { name: "Terms of Service" }));
  expect(mockOpenBrowser).toHaveBeenLastCalledWith("https://artlog.dwjiang.com/terms");
  await fireEvent.press(screen.getByRole("link", { name: "Privacy Policy" }));
  expect(mockOpenBrowser).toHaveBeenLastCalledWith("https://artlog.dwjiang.com/privacy");
  expect(screen.getByRole("header", { name: /Welcome to Artlog/ })).toBeOnTheScreen();
});

it("finishes as a guest without a name after declining the permission prompts", async () => {
  mockRequestCamera.mockResolvedValue(false);
  mockRequestPhotos.mockResolvedValue(declined);
  mockRequestLocation.mockResolvedValue(declined);
  await render(<WelcomeScreen />);
  await reachNamePage();
  expect(screen.getByRole("header", { name: "Your name." })).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("Name"), "   ");
  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  expect(await getLocalProfileName()).toBeUndefined();
  expect(await settings.getSetting("welcome-seen")).toBe("true");
  // A guest's answer waits on the phone until they sign in.
  expect(await settings.getSetting("safety-checks")).toBe("on");
  expect(mockConvexMutation).not.toHaveBeenCalled();
  expect(mockRequestCamera).toHaveBeenCalledTimes(1);
  expect(mockRequestPhotos).toHaveBeenCalledTimes(1);
  expect(mockRequestLocation).toHaveBeenCalledTimes(1);
});

it("goes back one page at a time without raising a prompt", async () => {
  await render(<WelcomeScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Get started" }));
  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByRole("header", { name: "Keep the photo." })).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByLabelText("Step 1 of 6")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Scan artworks." })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("header", { name: /Welcome to Artlog/ })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  expect(screen.queryByLabelText(/^Step /)).toBeNull();
  expect(mockRequestCamera).toHaveBeenCalledTimes(1);
  expect(mockRequestPhotos).not.toHaveBeenCalled();
});

it("moves on without asking again when a permission is already answered", async () => {
  mockCamera = { hasPermission: false, canRequestPermission: false };
  await render(<WelcomeScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Get started" }));
  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  expect(mockRequestCamera).not.toHaveBeenCalled();
  expect(await screen.findByLabelText("Step 2 of 6")).toBeOnTheScreen();
});

it("prefills the saved name when onboarding is reopened, and clears it when emptied", async () => {
  await setLocalProfileName("Alex");
  await render(<WelcomeScreen />);
  await reachNamePage();
  expect(await screen.findByDisplayValue("Alex")).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("Name"), "");
  await fireEvent(screen.getByLabelText("Name"), "submitEditing");
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  expect(await getLocalProfileName()).toBeUndefined();
});

it("keeps the entered name and retries when saving fails", async () => {
  const failure = new Error("Disk unavailable");
  await render(<WelcomeScreen />);
  await reachNamePage();
  jest.spyOn(settings, "setSetting").mockRejectedValueOnce(failure);
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
  await continueThroughPermissions();
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

it("takes a signed-in account through the permissions and safety checks only", async () => {
  switchOwner("account:alex");
  await render(<WelcomeScreen />);
  expect(screen.queryByLabelText(/^Step /)).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Get started" }));
  expect(screen.getByLabelText("Step 1 of 4")).toBeOnTheScreen();
  for (const next of ["Step 2 of 4", "Step 3 of 4", "Step 4 of 4"]) {
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByLabelText(next)).toBeOnTheScreen();
  }
  await fireEvent.press(screen.getByRole("button", { name: "Allow" }));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  expect(mockConvexMutation).toHaveBeenCalledWith(expect.anything(), { enabled: true });
  expect(screen.queryByRole("header", { name: "Save your collection." })).toBeNull();
  expect(await settings.getSetting("welcome-seen")).toBe("true");
});

async function reachSafetyPage() {
  await fireEvent.press(screen.getByRole("button", { name: "Get started" }));
  for (let page = 0; page < 3; page++) {
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  }
  expect(screen.getByRole("header", { name: "Keep posts safe." })).toBeOnTheScreen();
}

it("keeps a failed signed-in opt-out on screen and retries the explicit choice", async () => {
  switchOwner("account:alex");
  const failure = new Error("Consent write failed");
  mockConvexMutation.mockRejectedValueOnce(failure);
  await render(<WelcomeScreen />);
  await reachSafetyPage();
  await fireEvent.press(screen.getByRole("button", { name: "Don’t Allow" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your choice couldn’t be saved. Please try again.");
  expect(mockBack).not.toHaveBeenCalled();
  expect(await settings.getSetting("welcome-seen")).toBeUndefined();
  expect(await settings.getSetting("safety-checks")).toBeUndefined();
  expect(reportError).toHaveBeenCalledWith(failure, "account.welcome.safety_checks");

  await fireEvent.press(screen.getByRole("button", { name: "Don’t Allow" }));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  expect(mockConvexMutation).toHaveBeenLastCalledWith(expect.anything(), { enabled: false });
});

it("blocks duplicate answers and going back while signed-in consent is saving", async () => {
  switchOwner("account:alex");
  let finish!: (enabled: boolean) => void;
  mockConvexMutation.mockReturnValueOnce(new Promise<boolean>((resolve) => (finish = resolve)));
  await render(<WelcomeScreen />);
  await reachSafetyPage();
  await fireEvent.press(screen.getByRole("button", { name: "Don’t Allow" }));
  expect(screen.getByRole("button", { name: "Allow" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Don’t Allow" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
  expect(mockBack).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Allow" }));
  expect(mockConvexMutation).toHaveBeenCalledTimes(1);
  await act(() => finish(false));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
});

it("keeps a guest on the consent page when saving their changed answer fails", async () => {
  await settings.setSetting("safety-checks", "on");
  await render(<WelcomeScreen />);
  await reachSafetyPage();
  jest.spyOn(settings, "setSetting").mockRejectedValueOnce(new Error("Disk unavailable"));
  await fireEvent.press(screen.getByRole("button", { name: "Don’t Allow" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your choice couldn’t be saved. Please try again.");
  expect(screen.getByRole("header", { name: "Keep posts safe." })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Don’t Allow" }));
  expect(await screen.findByRole("header", { name: "Save your collection." })).toBeOnTheScreen();
  expect(await settings.getSetting("safety-checks")).toBe("off");
});

it("saves a chosen photo with the name, and keeps the name page usable when Photos fails", async () => {
  const savePhoto = jest.spyOn(localProfile, "setLocalProfilePhoto").mockResolvedValue();
  const failure = new Error("Picker unavailable");
  jest.mocked(chooseProfilePhoto).mockRejectedValueOnce(failure).mockResolvedValueOnce("file:///cache/me.jpg");
  await render(<WelcomeScreen />);
  await reachNamePage();

  await fireEvent.press(screen.getByRole("button", { name: "Change picture" }));
  await fireEvent.press(screen.getByRole("button", { name: "Choose photo" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("This photo could not be opened. Try another image.");
  expect(reportError).toHaveBeenCalledWith(failure, "profile.photo.choose");

  await fireEvent.press(screen.getByRole("button", { name: "Choose photo" }));
  expect(await screen.findByText("Your photo")).toBeOnTheScreen();
  expect(screen.queryByRole("alert")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  expect(savePhoto).not.toHaveBeenCalled();

  await fireEvent.changeText(screen.getByLabelText("Name"), "Alex");
  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  expect(savePhoto).toHaveBeenCalledWith("file:///cache/me.jpg");
  expect(await getLocalProfileName()).toBe("Alex");
});

it("saves a picked painting with the name", async () => {
  const saveAvatar = jest.spyOn(localProfile, "setLocalProfileAvatar").mockResolvedValue();
  await render(<WelcomeScreen />);
  await reachNamePage();
  await fireEvent.press(screen.getByRole("button", { name: "Change picture" }));
  await fireEvent.press(screen.getByRole("button", { name: "Senecio, Paul Klee" }));
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  await fireEvent.changeText(screen.getByLabelText("Name"), "Alex");
  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  expect(saveAvatar).toHaveBeenCalledWith("klee");
});
