import { fireEvent, render, screen } from "@testing-library/react-native";

import { PhotoViewer, PhotoViewerButton } from "./photo-viewer";

jest.mock("@/lib/ui/image-sizes", () => ({ knownImageSize: () => undefined, rememberImageSize: jest.fn() }));

const onClose = jest.fn();
const onDetails = jest.fn();
beforeEach(() => jest.clearAllMocks());

function renderViewer(visible: boolean) {
  return render(
    <PhotoViewer
      visible={visible}
      uri="file:///photos/water-lilies.jpg"
      label="Your photo of Water Lilies"
      onClose={onClose}
      actions={<PhotoViewerButton icon="info.circle" label="Photo details" onPress={onDetails} />}
    />,
  );
}

it("shows the photo full screen only while open, with Close and the given actions", async () => {
  const view = await renderViewer(false);
  expect(screen.queryByRole("image", { name: "Your photo of Water Lilies" })).toBeNull();
  await view.rerender(
    <PhotoViewer
      visible
      uri="file:///photos/water-lilies.jpg"
      label="Your photo of Water Lilies"
      onClose={onClose}
      actions={<PhotoViewerButton icon="info.circle" label="Photo details" onPress={onDetails} />}
    />,
  );
  expect(screen.getByRole("image", { name: "Your photo of Water Lilies" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Photo details" }));
  expect(onDetails).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("closes with the VoiceOver escape gesture and offers zoom without pinching", async () => {
  await renderViewer(true);
  const photo = screen.getByRole("image", { name: "Your photo of Water Lilies" });
  expect(photo.props.accessibilityActions.map((action: { label: string }) => action.label)).toEqual([
    "Zoom in",
    "Zoom out",
  ]);
  await fireEvent(photo, "accessibilityEscape");
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("says so when the photo can't load", async () => {
  await renderViewer(true);
  const photo = screen.getByRole("image", { name: "Your photo of Water Lilies" });
  const image = (photo.children[0] as typeof photo).children[0] as typeof photo;
  await fireEvent(image, "error", { nativeEvent: { error: "Missing file" } });
  expect(screen.getByText("Photo unavailable")).toBeOnTheScreen();
});
