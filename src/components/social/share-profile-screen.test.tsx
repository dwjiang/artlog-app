import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";

import { dismissToast, useToast } from "@/lib/ui/toast";

import { ShareProfileScreen } from "./share-profile-screen";

const mockBack = jest.fn();
const mockRefresh = jest.fn();
const mockShare = jest.fn();
const mockDelete = jest.fn();
const mockWrite = jest.fn();
const mockDispose = jest.fn();
const mockSnapshot = jest.fn();
const mockPermission = jest.fn();
const mockSavePhoto = jest.fn();
jest.mock("expo-sharing", () => ({
  shareAsync: (...args: unknown[]) => mockShare(...args),
}));
jest.mock("expo-file-system", () => ({
  Paths: { cache: "file:///cache" },
  File: class {
    uri: string;
    constructor(directory: string, name: string) {
      this.uri = `${directory}/${name}`;
    }
    writeSync = mockWrite;
    delete = mockDelete;
  },
}));
jest.mock("@shopify/react-native-skia", () => ({
  ImageFormat: { PNG: 4 },
  makeImageFromView: (...args: unknown[]) => mockSnapshot(...args),
}));
jest.mock("expo-media-library", () => ({
  requestPermissionsAsync: (...args: unknown[]) => mockPermission(...args),
  Asset: { create: (...args: unknown[]) => mockSavePhoto(...args) },
}));
let mockResult: { data: unknown; loading: boolean; error?: Error };
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack }),
  useLocalSearchParams: () => ({ profileId: "public-profile" }),
}));
jest.mock("@/lib/social/use-social-session", () => ({
  useSocialSession: () => ({ key: "guest", status: "signed-out" }),
}));
jest.mock("@/lib/social/use-social-query", () => ({
  useSocialQuery: () => ({ ...mockResult, refresh: mockRefresh }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  dismissToast();
  mockResult = { data: undefined, loading: true };
  mockShare.mockResolvedValue(undefined);
  mockPermission.mockResolvedValue({ granted: true });
  mockSavePhoto.mockResolvedValue({});
  mockSnapshot.mockResolvedValue({ encodeToBytes: () => new Uint8Array([137, 80, 78, 71]), dispose: mockDispose });
});

afterEach(() => dismissToast());

const person = { profileId: "public-profile", name: "Jamie Lee", username: "jamielee" };

async function displayQr() {
  await fireEvent(screen.getByLabelText("QR code for Jamie Lee’s Artlog profile"), "display");
}

it("blocks exports until the QR image has displayed", async () => {
  mockResult = { data: person, loading: false };
  await render(<ShareProfileScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Share" }));
  await fireEvent.press(screen.getByRole("button", { name: "Save to Photos" }));
  expect(mockSnapshot).not.toHaveBeenCalled();
  expect(mockPermission).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Share" })).toBeDisabled();
  await displayQr();
  expect(screen.getByRole("button", { name: "Share" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Save to Photos" })).toBeEnabled();
});

it("waits for an uncached photo to display, even after its download completes", async () => {
  mockResult = { data: { ...person, photoUrl: "https://example.com/photo.jpg" }, loading: false };
  await render(<ShareProfileScreen />);
  await displayQr();
  const photo = screen.getByLabelText("Jamie Lee profile photo", { includeHiddenElements: true });
  await fireEvent(photo, "load", { nativeEvent: { source: { width: 88, height: 88 } } });
  expect(screen.getByRole("button", { name: "Share" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save to Photos" })).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: "Share" }));
  expect(mockSnapshot).not.toHaveBeenCalled();
  await fireEvent(photo, "display");
  await fireEvent.press(screen.getByRole("button", { name: "Share" }));
  await waitFor(() => expect(mockShare).toHaveBeenCalledTimes(1));
});

it("waits for the preset avatar after a photo fails", async () => {
  mockResult = {
    data: { ...person, photoUrl: "https://example.com/broken.jpg", avatar: "vermeer" },
    loading: false,
  };
  await render(<ShareProfileScreen />);
  await displayQr();
  await fireEvent(screen.getByLabelText("Jamie Lee profile photo", { includeHiddenElements: true }), "error", {
    nativeEvent: { error: "Unavailable" },
  });
  expect(screen.getByRole("button", { name: "Share" })).toBeDisabled();
  const preset = screen.getByLabelText("Jamie Lee profile avatar", { includeHiddenElements: true });
  await fireEvent(preset, "display");
  expect(screen.getByRole("button", { name: "Share" })).toBeEnabled();
});

it("allows exports once a failed photo falls back to initials", async () => {
  mockResult = { data: { ...person, photoUrl: "https://example.com/broken.jpg" }, loading: false };
  await render(<ShareProfileScreen />);
  await displayQr();
  await fireEvent(screen.getByLabelText("Jamie Lee profile photo", { includeHiddenElements: true }), "error", {
    nativeEvent: { error: "Unavailable" },
  });
  await fireEvent(screen.getByText("JL", { includeHiddenElements: true }), "layout");
  expect(screen.getByRole("button", { name: "Save to Photos" })).toBeEnabled();
});

it("falls back to initials if a preset avatar cannot display", async () => {
  mockResult = { data: { ...person, avatar: "vermeer" }, loading: false };
  await render(<ShareProfileScreen />);
  await displayQr();
  expect(screen.getByRole("button", { name: "Share" })).toBeDisabled();
  const preset = screen.getByLabelText("Jamie Lee profile avatar", { includeHiddenElements: true });
  await fireEvent(preset, "error", { nativeEvent: { error: "Unavailable" } });
  await fireEvent(screen.getByText("JL", { includeHiddenElements: true }), "layout");
  expect(screen.getByRole("button", { name: "Share" })).toBeEnabled();
});

it("keeps exports blocked after a QR failure and offers a reload", async () => {
  const toast = await renderHook(useToast);
  mockResult = { data: person, loading: false };
  await render(<ShareProfileScreen />);
  const failedQr = screen.getByLabelText("QR code for Jamie Lee’s Artlog profile");
  await fireEvent(failedQr, "error", { nativeEvent: { error: "Unavailable" } });
  expect(screen.getByRole("button", { name: "Share" })).toBeDisabled();
  expect(toast.result.current).toMatchObject({ message: "Couldn’t load your QR code.", action: { label: "Retry" } });
  await act(() => toast.result.current?.action?.onPress());
  expect(screen.getByLabelText("QR code for Jamie Lee’s Artlog profile")).not.toBe(failedQr);
  await displayQr();
  expect(screen.getByRole("button", { name: "Share" })).toBeEnabled();
});

it("requires the replacement photo to display after a profile refresh", async () => {
  mockResult = { data: person, loading: false };
  const view = await render(<ShareProfileScreen />);
  await displayQr();
  expect(screen.getByRole("button", { name: "Share" })).toBeEnabled();
  mockResult = { data: { ...person, photoUrl: "https://example.com/new.jpg" }, loading: false };
  await view.rerender(<ShareProfileScreen />);
  await displayQr();
  expect(screen.getByRole("button", { name: "Share" })).toBeDisabled();
  await fireEvent(screen.getByLabelText("Jamie Lee profile photo", { includeHiddenElements: true }), "display");
  expect(screen.getByRole("button", { name: "Share" })).toBeEnabled();
});

it("distinguishes loading from a completed unavailable profile and provides a way out", async () => {
  const view = await render(<ShareProfileScreen />);
  expect(screen.getByLabelText("Opening your profile…")).toBeOnTheScreen();
  expect(screen.queryByText("Profile unavailable.")).toBeNull();
  mockResult = { data: null, loading: false };
  await view.rerender(<ShareProfileScreen />);
  expect(screen.getByText("Profile unavailable.")).toBeOnTheScreen();
  expect(screen.queryByLabelText("Opening your profile…")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Back" }));
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it("retries an unsuccessful profile query without calling it unavailable", async () => {
  mockResult = { data: undefined, loading: false, error: new Error("Offline") };
  await render(<ShareProfileScreen />);
  expect(screen.getByText("Couldn’t load your profile.")).toBeOnTheScreen();
  expect(screen.queryByText("Profile unavailable.")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});

it("shows the profile card and shares it as a PNG through the native share sheet", async () => {
  mockResult = { data: person, loading: false };
  await render(<ShareProfileScreen />);
  expect(screen.getByRole("header", { name: "Jamie Lee" })).toBeOnTheScreen();
  expect(screen.getByText("@jamielee")).toBeOnTheScreen();
  expect(screen.getByLabelText("QR code for Jamie Lee’s Artlog profile")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  await displayQr();
  await fireEvent.press(screen.getByRole("button", { name: "Share" }));
  await waitFor(() =>
    expect(mockShare).toHaveBeenCalledWith(
      "file:///cache/Artlog - jamielee.png",
      expect.objectContaining({ mimeType: "image/png", UTI: "public.png" }),
    ),
  );
  expect(mockWrite).toHaveBeenCalledWith(new Uint8Array([137, 80, 78, 71]));
  expect(mockDispose).toHaveBeenCalledTimes(1);
  expect(mockDelete).toHaveBeenCalledTimes(1);
  expect(mockPermission).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Share" })).toBeEnabled();
});

it("saves the card to Photos and confirms only after the library accepts it", async () => {
  const toast = await renderHook(useToast);
  mockResult = { data: person, loading: false };
  let finishSave!: () => void;
  mockSavePhoto.mockReturnValueOnce(new Promise<void>((resolve) => (finishSave = resolve)));
  await render(<ShareProfileScreen />);
  await displayQr();
  await fireEvent.press(screen.getByRole("button", { name: "Save to Photos" }));
  await waitFor(() => expect(mockSavePhoto).toHaveBeenCalledWith("file:///cache/Artlog - jamielee.png"));
  expect(mockPermission).toHaveBeenCalledWith(true);
  expect(screen.getByRole("button", { name: "Save to Photos" })).toBeBusy();
  expect(screen.getByRole("button", { name: "Share" })).toBeDisabled();
  expect(toast.result.current).toBeUndefined();
  await act(async () => finishSave());
  expect(toast.result.current).toMatchObject({ message: "Saved to Photos." });
  expect(mockDelete).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Share" })).toBeEnabled();
});

it("points to Settings when Photos access is declined instead of drawing the card", async () => {
  const toast = await renderHook(useToast);
  mockResult = { data: person, loading: false };
  mockPermission.mockResolvedValueOnce({ granted: false });
  const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue();
  await render(<ShareProfileScreen />);
  await displayQr();
  await fireEvent.press(screen.getByRole("button", { name: "Save to Photos" }));
  await waitFor(() =>
    expect(toast.result.current).toMatchObject({
      message: "Allow Photos access in Settings to save your card.",
      action: { label: "Settings" },
    }),
  );
  expect(mockSnapshot).not.toHaveBeenCalled();
  expect(mockSavePhoto).not.toHaveBeenCalled();
  await act(() => toast.result.current?.action?.onPress());
  expect(openSettings).toHaveBeenCalledTimes(1);
});

it("allows retry when the card cannot be drawn", async () => {
  const toast = await renderHook(useToast);
  mockResult = { data: person, loading: false };
  mockSnapshot.mockResolvedValueOnce(null);
  await render(<ShareProfileScreen />);
  await displayQr();
  await fireEvent.press(screen.getByRole("button", { name: "Share" }));
  await waitFor(() =>
    expect(toast.result.current).toMatchObject({
      message: "Couldn’t share your profile card.",
      action: { label: "Retry" },
    }),
  );
  expect(mockShare).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Share" })).toBeEnabled();
  await act(() => toast.result.current?.action?.onPress());
  await waitFor(() => expect(mockShare).toHaveBeenCalledTimes(1));
});
