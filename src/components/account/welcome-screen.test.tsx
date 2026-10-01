import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Dimensions } from "react-native";

import * as settings from "@/db/repos/settings";
import { getLocalProfileName, setLocalProfileName } from "@/lib/account/local-profile";
import { reportError } from "@/lib/observability";

import { WelcomeScreen } from "./welcome-screen";

type Permission = { granted: boolean; canAskAgain: boolean } | null;

const mockBack = jest.fn();
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
  useRouter: () => ({ back: mockBack }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
jest.mock("react-native-worklets", () => jest.requireActual("react-native-worklets/lib/module/mock"));
jest.mock("react-native-reanimated", () => ({
  ...jest.requireActual("react-native-reanimated/mock"),
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

const allowed = { granted: true, canAskAgain: true };

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
});

it("asks for each permission before saving a name and completing onboarding", async () => {
  await render(<WelcomeScreen />);
  expect(screen.getByLabelText("Page 1 of 5")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: /Welcome to Artlog/ })).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole("button", { name: "Get started" }));
  expect(screen.getByLabelText("Page 2 of 5")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Scan artworks." })).toBeOnTheScreen();
  expect(screen.getByText("Artwork photos stay on your phone")).toBeOnTheScreen();
  expect(screen.queryByRole("header", { name: /Welcome to Artlog/ })).toBeNull();

  await fireEvent.press(screen.getByRole("button", { name: "Allow camera" }));
  expect(mockRequestCamera).toHaveBeenCalledTimes(1);
  expect(await screen.findByLabelText("Page 3 of 5")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Keep the photo." })).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole("button", { name: "Not now" }));
  expect(mockRequestPhotos).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Page 4 of 5")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Find the museum." })).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole("button", { name: "Allow location" }));
  expect(mockRequestLocation).toHaveBeenCalledTimes(1);
  expect(await screen.findByLabelText("Page 5 of 5")).toBeOnTheScreen();
  expect(mockBack).not.toHaveBeenCalled();
  expect(await settings.getSetting("welcome-seen")).toBeUndefined();
  expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
  await fireEvent.changeText(screen.getByLabelText("Name"), "  Alex Rivera  ");
  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  expect(await getLocalProfileName()).toBe("Alex Rivera");
  expect(await settings.getSetting("welcome-seen")).toBe("true");
});

it("skips permission prompts but still requires a name or nickname", async () => {
  await render(<WelcomeScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Skip" }));
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

it("follows the page a visitor swipes to", async () => {
  await render(<WelcomeScreen />);
  await fireEvent(screen.getByText("Remember the art that stays with you."), "momentumScrollEnd", {
    nativeEvent: { contentOffset: { x: Dimensions.get("window").width * 2 } },
  });
  expect(screen.getByLabelText("Page 3 of 5")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Keep the photo." })).toBeOnTheScreen();
});

it("moves on without asking again when a permission is already answered", async () => {
  mockCamera = { hasPermission: false, canRequestPermission: false };
  await render(<WelcomeScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Get started" }));
  expect(screen.queryByRole("button", { name: "Not now" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  expect(mockRequestCamera).not.toHaveBeenCalled();
  expect(await screen.findByLabelText("Page 3 of 5")).toBeOnTheScreen();
});

it("prefills the saved name when onboarding is reopened", async () => {
  await setLocalProfileName("Alex");
  await render(<WelcomeScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Skip" }));
  expect(await screen.findByDisplayValue("Alex")).toBeOnTheScreen();
});

it("keeps the entered name and retries when saving fails", async () => {
  const failure = new Error("Disk unavailable");
  jest.spyOn(settings, "setSetting").mockRejectedValueOnce(failure);
  await render(<WelcomeScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Skip" }));
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
