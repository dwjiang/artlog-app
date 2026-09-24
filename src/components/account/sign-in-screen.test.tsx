import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { offerProfileSetup, takeProfileSetupOffer } from "@/lib/account/profile-setup-offer";

import { SignInScreen } from "./sign-in-screen";

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockSignIn = jest.fn();
const mockRouter = { back: mockBack, replace: mockReplace };
let mockOwner = "device:guest";
let mockOnline = true;
let mockAccount = {
  account: { linked: false, accountId: "account-a", hasProfile: false },
  available: true,
  busy: false,
  error: undefined as string | undefined,
  ready: true,
  signInWithApple: mockSignIn,
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
jest.mock("expo-apple-authentication", () => ({
  AppleAuthenticationButtonType: { SIGN_IN: 0 },
  AppleAuthenticationButtonStyle: { BLACK: 0 },
  AppleAuthenticationButton: ({ onPress }: { onPress: () => void }) => {
    const { Pressable, Text } = jest.requireActual("react-native");
    return (
      <Pressable accessibilityRole="button" onPress={onPress}>
        <Text>Sign in with Apple</Text>
      </Pressable>
    );
  },
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
    error: undefined,
  };
});

it("shows context, starts Apple sign-in, and lets a guest dismiss", async () => {
  await render(<SignInScreen context="wall" />);
  expect(screen.getByRole("header", { name: "Sign in to share your wall" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Sign in with Apple" }));
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
  expect(screen.queryByRole("button", { name: "Sign in with Apple" })).toBeNull();
  expect(mockBack).not.toHaveBeenCalled();
  mockAccount.busy = false;
  await view.rerender(<SignInScreen />);
  expect(mockBack).toHaveBeenCalledTimes(1);
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

it("continues to the visit editor only after the linked account has its local journal", async () => {
  const view = await render(<SignInScreen context="visit" visitId="museum-visit" />);
  expect(screen.getByRole("header", { name: "Sign in to share this visit" })).toBeOnTheScreen();
  mockAccount.account.linked = true;
  await view.rerender(<SignInScreen context="visit" visitId="museum-visit" />);
  expect(screen.getByLabelText("Syncing your journal…")).toBeOnTheScreen();
  expect(mockReplace).not.toHaveBeenCalled();
  mockOwner = "account:account-a";
  await view.rerender(<SignInScreen context="visit" visitId="museum-visit" />);
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: "/visit-share/[visitId]",
    params: { visitId: "museum-visit" },
  });
  expect(mockBack).not.toHaveBeenCalled();
});

it("hands a first sign-in without a profile to setup, carrying Apple’s name and the visit", async () => {
  const view = await render(<SignInScreen context="visit" visitId="museum-visit" />);
  mockAccount = { ...mockAccount, account: { linked: true, accountId: "account-a", hasProfile: false } };
  await act(() => offerProfileSetup({ name: "Alex Morgan" }));
  await view.rerender(<SignInScreen context="visit" visitId="museum-visit" />);
  expect(mockReplace).toHaveBeenCalledTimes(1);
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: "/create-profile",
    params: { name: "Alex Morgan", visitId: "museum-visit" },
  });
  expect(takeProfileSetupOffer()).toBeUndefined();
  expect(mockBack).not.toHaveBeenCalled();
});

it("closes as before when the signed-in account already has a profile", async () => {
  offerProfileSetup({ name: "Alex Morgan" });
  mockAccount = { ...mockAccount, account: { linked: true, accountId: "account-a", hasProfile: true } };
  await render(<SignInScreen />);
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockReplace).not.toHaveBeenCalled();
});
