import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ShareProfileScreen } from "./share-profile-screen";

const mockBack = jest.fn(),
  mockRefresh = jest.fn();
const mockShare = jest.fn(),
  mockDelete = jest.fn(),
  mockReleaseImage = jest.fn(),
  mockReleaseContext = jest.fn();
const mockManipulate = jest.fn();
jest.mock("expo-sharing", () => ({
  shareAsync: (...args: unknown[]) => mockShare(...args),
}));
jest.mock("expo-file-system", () => ({
  File: class {
    delete = mockDelete;
  },
}));
jest.mock("expo-image-manipulator", () => ({
  ImageManipulator: {
    manipulate: (...args: unknown[]) => mockManipulate(...args),
  },
  SaveFormat: { PNG: "png" },
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
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
  mockResult = { data: undefined, loading: true };
  mockShare.mockResolvedValue(undefined);
  mockManipulate.mockImplementation(() => ({
    release: mockReleaseContext,
    renderAsync: async () => ({
      release: mockReleaseImage,
      saveAsync: async () => ({ uri: "file:///cache/profile-qr.png" }),
    }),
  }));
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

it("shows the profile identity and shares a PNG QR code through the native share sheet", async () => {
  mockResult = {
    data: {
      profileId: "public-profile",
      name: "Jamie Lee",
      username: "jamielee",
    },
    loading: false,
  };
  await render(<ShareProfileScreen />);
  expect(screen.getByRole("header", { name: "Jamie Lee" })).toBeOnTheScreen();
  expect(screen.getByLabelText("QR code for Jamie Lee’s Artlog profile")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Share QR code" }));
  await waitFor(() =>
    expect(mockShare).toHaveBeenCalledWith(
      "file:///cache/profile-qr.png",
      expect.objectContaining({ mimeType: "image/png", UTI: "public.png" }),
    ),
  );
  expect(mockManipulate).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/gif;base64,/));
  expect(mockReleaseImage).toHaveBeenCalledTimes(1);
  expect(mockReleaseContext).toHaveBeenCalledTimes(1);
  expect(mockDelete).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it("allows retry when QR image preparation fails before creating a context", async () => {
  mockResult = {
    data: {
      profileId: "public-profile",
      name: "Jamie Lee",
      username: "jamielee",
    },
    loading: false,
  };
  mockManipulate.mockImplementationOnce(() => {
    throw new Error("Image unavailable");
  });
  await render(<ShareProfileScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Share QR code" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Your QR code could not be shared. Try again.");
  expect(screen.getByRole("button", { name: "Share QR code" })).toBeEnabled();
  await fireEvent.press(screen.getByRole("button", { name: "Share QR code" }));
  await waitFor(() => expect(mockShare).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("alert")).toBeNull();
});
