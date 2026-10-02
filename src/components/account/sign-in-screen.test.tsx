import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { offerProfileSetup, takeProfileSetupOffer } from "@/lib/account/profile-setup-offer";

import { SignInScreen } from "./sign-in-screen";

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockSignIn = jest.fn();
const mockGoogleSignIn = jest.fn();
const mockRouter = { back: mockBack, replace: mockReplace };
let mockOwner = "device:guest";
let mockOnline = true;
let mockAccount = {
  account: { linked: false, accountId: "account-a", hasProfile: false },
  available: true,
  googleAvailable: true,
  busy: false,
  error: undefined as string | undefined,
  ready: true,
  signInWithApple: mockSignIn,
  signInWithGoogle: mockGoogleSignIn,
};
jest.mock("@/lib/account/owner-store", () => ({
  useLocalOwner: () => mockOwner,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/lib/account/use-account", () => ({
  useAccount: () => mockAccount,
}));
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  Stack: { Screen: () => null },
}));
jest.mock("expo-network", () => ({
  useNetworkState: () => ({
    isConnected: mockOnline,
    isInternetReachable: mockOnline,
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  takeProfileSetupOffer();
  mockOwner = "device:guest";
  mockOnline = true;
  mockAccount = {
    ...mockAccount,
    account: { linked: false, accountId: "account-a", hasProfile: false },
    busy: false,
    ready: true,
    available: true,
    googleAvailable: true,
    error: undefined,
  };
});

it("shows context, starts Apple sign-in, and lets a guest dismiss", async () => {
  await render(<SignInScreen context="wall" />);
  expect(screen.getByRole("header", { name: "Sign in to share your wall" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Continue with Apple" }));
  expect(mockSignIn).toHaveBeenCalledTimes(1);
  expect(mockBack).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Not now" }));
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it("keeps sign-in errors retryable and closes only after linking finishes", async () => {
  mockAccount.error = "Couldn’t update your account.";
  const view = await render(<SignInScreen />);
  expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t update your account.");
  mockAccount = {
    ...mockAccount,
    busy: true,
    account: { linked: true, accountId: "account-a", hasProfile: false },
  };
  await view.rerender(<SignInScreen />);
  expect(screen.getByRole("button", { name: "Not now" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Continue with Apple" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Continue with Google" })).toBeDisabled();
  expect(mockBack).not.toHaveBeenCalled();
  mockAccount.busy = false;
  await view.rerender(<SignInScreen />);
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it("shows sign-in progress inside the chosen provider button", async () => {
  const view = await render(<SignInScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Continue with Google" }));
  mockAccount = { ...mockAccount, busy: true };
  await view.rerender(<SignInScreen />);
  expect(screen.getByRole("button", { name: "Continue with Google", busy: true })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Continue with Apple", busy: false })).toBeDisabled();
  expect(screen.queryByText("Signing in…")).toBeNull();
});

it("starts Google independently of Apple availability", async () => {
  mockAccount.available = false;
  await render(<SignInScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Continue with Google" }));
  expect(mockGoogleSignIn).toHaveBeenCalledTimes(1);
  expect(mockSignIn).not.toHaveBeenCalled();
});

it("keeps Google disabled until configured while Apple stays usable", async () => {
  mockAccount.googleAvailable = false;
  await render(<SignInScreen />);
  expect(screen.getByRole("button", { name: "Continue with Google" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Continue with Apple" })).toBeEnabled();
});

it("disables both providers offline even if the device was already ready", async () => {
  mockOnline = false;
  await render(<SignInScreen />);
  expect(screen.getByRole("button", { name: "Continue with Google" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Continue with Apple" })).toBeDisabled();
});

it("returns to the previous activity when the close button is pressed", async () => {
  await render(<SignInScreen context="friends" />);
  await fireEvent.press(screen.getByRole("button", { name: "Close sign-in" }));
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockSignIn).not.toHaveBeenCalled();
});

it("waits for the device with a spinner online and explains the wait offline", async () => {
  mockAccount.ready = false;
  const view = await render(<SignInScreen />);
  expect(screen.getByRole("progressbar", { name: "Connecting to your account" })).toBeOnTheScreen();
  mockOnline = false;
  await view.rerender(<SignInScreen />);
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.getByText("Connect to the internet to sign in.")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Not now" })).toBeEnabled();
});

it("explains unavailable sign-in without preventing dismissal", async () => {
  mockAccount.available = false;
  await render(<SignInScreen />);
  expect(screen.getByText("Apple sign-in is unavailable on this device.")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Not now" })).toBeEnabled();
});

it.each([undefined, "friends"] as const)(
  "continues to the visit editor with audience %s only after the linked journal is ready",
  async (audience) => {
    const view = await render(<SignInScreen context="visit" visitId="museum-visit" audience={audience} />);
    expect(screen.getByRole("header", { name: "Sign in to share this visit" })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Continue with Apple" }));
    mockAccount.account.linked = true;
    await view.rerender(<SignInScreen context="visit" visitId="museum-visit" audience={audience} />);
    expect(screen.getByRole("button", { name: "Continue with Apple", busy: true })).toBeDisabled();
    expect(mockReplace).not.toHaveBeenCalled();
    mockOwner = "account:account-a";
    await view.rerender(<SignInScreen context="visit" visitId="museum-visit" audience={audience} />);
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: "/visit-share/[visitId]",
      params: { visitId: "museum-visit", ...(audience ? { audience } : {}) },
    });
    expect(mockBack).not.toHaveBeenCalled();
  },
);

it.each([undefined, "friends"] as const)(
  "carries the name, visit and audience %s through first-time profile setup",
  async (audience) => {
    const view = await render(<SignInScreen context="visit" visitId="museum-visit" audience={audience} />);
    mockAccount = { ...mockAccount, account: { linked: true, accountId: "account-a", hasProfile: false } };
    await act(() => offerProfileSetup({ name: "Alex Morgan" }));
    await view.rerender(<SignInScreen context="visit" visitId="museum-visit" audience={audience} />);
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: "/create-profile",
      params: { name: "Alex Morgan", visitId: "museum-visit", ...(audience ? { audience } : {}) },
    });
    expect(takeProfileSetupOffer()).toBeUndefined();
    expect(mockBack).not.toHaveBeenCalled();
  },
);

it("closes as before when the signed-in account already has a profile", async () => {
  offerProfileSetup({ name: "Alex Morgan" });
  mockAccount = { ...mockAccount, account: { linked: true, accountId: "account-a", hasProfile: true } };
  await render(<SignInScreen />);
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockReplace).not.toHaveBeenCalled();
});
