import { fireEvent, render, screen } from "@testing-library/react-native";

import { SavedWorkImage } from "./saved-work-image";

let mockOnline = true;
jest.mock("expo-network", () => ({
  useNetworkState: () => ({
    isConnected: mockOnline,
    isInternetReachable: mockOnline,
  }),
}));
beforeEach(() => {
  mockOnline = true;
});

jest.mock("@/lib/files/photos", () => ({
  captureFileUri: (path: string) => `file:///${path}`,
}));

it("shows a ghost while an account photo is awaiting download", async () => {
  await render(<SavedWorkImage path={null} title="Water Lilies" syncing style={{ width: 240, height: 240 }} />);
  expect(
    screen.getByRole("progressbar", {
      name: "Downloading photo: Water Lilies",
    }),
  ).toBeOnTheScreen();
  expect(screen.queryByText("Photo syncing…")).toBeNull();
  expect(screen.queryByLabelText("Your photo of Water Lilies")).toBeNull();
});

it("uses a labeled neutral icon in a compact thumbnail without clipping status text", async () => {
  await render(<SavedWorkImage path={null} title="Water Lilies" style={{ width: 56, height: 48 }} />);
  expect(screen.getByRole("image", { name: "Water Lilies: no photo" })).toBeOnTheScreen();
  expect(screen.queryByText("No photo")).toBeNull();
  expect(screen.queryByText("Photo syncing…")).toBeNull();
});

it("shows a readable no-photo message on a large surface instead of implying a transfer", async () => {
  await render(<SavedWorkImage path={null} title="Water Lilies" style={{ width: 240, height: 240 }} />);
  expect(screen.getByText("No photo")).toBeOnTheScreen();
  expect(screen.queryByText("Photo syncing…")).toBeNull();
});

it("measures percentage-sized thumbnails before deciding whether status text fits", async () => {
  await render(<SavedWorkImage path={null} title="Water Lilies" style={{ width: "100%", height: "100%" }} />);
  const placeholder = screen.getByRole("image", {
    name: "Water Lilies: no photo",
  });
  await fireEvent(placeholder, "layout", {
    nativeEvent: { layout: { width: 32, height: 32 } },
  });
  expect(screen.queryByText("No photo")).toBeNull();
  await fireEvent(placeholder, "layout", {
    nativeEvent: { layout: { width: 240, height: 240 } },
  });
  expect(screen.getByText("No photo")).toBeOnTheScreen();
});

it("keeps artwork identity visible when an image fails and tries a changed photo path", async () => {
  const view = await render(
    <SavedWorkImage path="broken.jpg" title="Water Lilies" style={{ width: 100, height: 100 }} />,
  );
  await fireEvent(screen.getByLabelText("Your photo of Water Lilies"), "error", {
    nativeEvent: { error: "Image could not load" },
  });
  expect(screen.getByLabelText("Water Lilies: image unavailable")).toBeOnTheScreen();
  await view.rerender(<SavedWorkImage path="new.jpg" title="Water Lilies" style={{ width: 100, height: 100 }} />);
  expect(screen.getByLabelText("Your photo of Water Lilies")).toBeOnTheScreen();
  expect(screen.queryByText("Image unavailable")).toBeNull();
});

it("shows an offline status instead of endless animation without a connection", async () => {
  mockOnline = false;
  await render(<SavedWorkImage path={null} title="Water Lilies" syncing style={{ width: 240, height: 240 }} />);
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.getByText("Photo available when online")).toBeOnTheScreen();
});
