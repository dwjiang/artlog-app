import { fireEvent, render, screen } from "@testing-library/react-native";
import { Dimensions } from "react-native";

import { WelcomeScreen } from "./welcome-screen";

type Permission = { granted: boolean; canAskAgain: boolean } | null;

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockRequestCamera = jest.fn();
const mockRequestPhotos = jest.fn();
const mockRequestLocation = jest.fn();
let mockCamera = { hasPermission: false, canRequestPermission: true };
let mockPhotos: Permission = null;
let mockLocation: Permission = null;
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, replace: mockReplace }),
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

beforeEach(() => {
  jest.clearAllMocks();
  mockCamera = { hasPermission: false, canRequestPermission: true };
  mockPhotos = null;
  mockLocation = null;
  mockRequestCamera.mockResolvedValue(true);
  mockRequestPhotos.mockResolvedValue(allowed);
  mockRequestLocation.mockResolvedValue(allowed);
});

it("asks for each permission from its own page and finishes after the last answer", async () => {
  await render(<WelcomeScreen />);
  expect(screen.getByLabelText("Page 1 of 4")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: /Welcome to Artlog/ })).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole("button", { name: "Get started" }));
  expect(screen.getByLabelText("Page 2 of 4")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Scan artworks." })).toBeOnTheScreen();
  expect(screen.getByText("Artwork photos stay on your phone")).toBeOnTheScreen();
  expect(screen.queryByRole("header", { name: /Welcome to Artlog/ })).toBeNull();

  await fireEvent.press(screen.getByRole("button", { name: "Allow camera" }));
  expect(mockRequestCamera).toHaveBeenCalledTimes(1);
  expect(await screen.findByLabelText("Page 3 of 4")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Keep the photo." })).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole("button", { name: "Not now" }));
  expect(mockRequestPhotos).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Page 4 of 4")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Find the museum." })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();

  await fireEvent.press(screen.getByRole("button", { name: "Allow location" }));
  expect(mockRequestLocation).toHaveBeenCalledTimes(1);
  await screen.findByRole("button", { name: "Allow location" });
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it("lets a visitor skip every prompt", async () => {
  await render(<WelcomeScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Skip" }));
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockRequestCamera).not.toHaveBeenCalled();
  expect(mockRequestPhotos).not.toHaveBeenCalled();
  expect(mockRequestLocation).not.toHaveBeenCalled();
});

it("follows the page a visitor swipes to", async () => {
  await render(<WelcomeScreen />);
  await fireEvent(screen.getByText("Remember the art that stays with you."), "momentumScrollEnd", {
    nativeEvent: { contentOffset: { x: Dimensions.get("window").width * 2 } },
  });
  expect(screen.getByLabelText("Page 3 of 4")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Keep the photo." })).toBeOnTheScreen();
});

it("moves on without asking again when a permission is already answered", async () => {
  mockCamera = { hasPermission: false, canRequestPermission: false };
  await render(<WelcomeScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Get started" }));
  expect(screen.queryByRole("button", { name: "Not now" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  expect(mockRequestCamera).not.toHaveBeenCalled();
  expect(await screen.findByLabelText("Page 3 of 4")).toBeOnTheScreen();
});

it("opens optional sign-in without leaving another welcome screen underneath it", async () => {
  await render(<WelcomeScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "I already have an account" }));
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: "/sign-in",
    params: { context: "account" },
  });
});
