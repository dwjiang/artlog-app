import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { LocalVisitGalleryArtwork, VisitGallerySearch } from "./visit-gallery";

jest.mock("@/lib/files/photos", () => ({
  captureFileUri: (path: string) => `file:///${path}`,
}));
jest.mock("expo-image", () => ({
  Image: (props: object) => {
    const { View } = jest.requireActual("react-native");
    return <View {...props} />;
  },
}));

it("clears a visit artwork search", async () => {
  const onChangeText = jest.fn();
  await render(<VisitGallerySearch value="Garden" onChangeText={onChangeText} />);

  expect(screen.getByLabelText("Search visit artworks")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Clear search" }));
  expect(onChangeText).toHaveBeenCalledWith("");
});

it.each([
  [0, "No photos"],
  [3, "3 photos"],
] as const)("shows the title, artist fallback and badge for %s visit photos", async (photoCount, badge) => {
  await render(<LocalVisitGalleryArtwork title="Untitled study" artist={null} photoCount={photoCount} path={null} />);

  expect(screen.getByText("Untitled study")).toBeOnTheScreen();
  expect(screen.getByText("Artist unknown")).toBeOnTheScreen();
  expect(screen.getByText(badge)).toBeOnTheScreen();
});

it("omits the photo badge for a single photo", async () => {
  await render(<LocalVisitGalleryArtwork title="Garden" artist="Artist" photoCount={1} path="garden.jpg" />);
  expect(screen.queryByText(/photos/)).not.toBeOnTheScreen();
});

it.each([
  [600, 1200],
  [1200, 600],
])("fits a %s × %s photo to its own proportions", async (width, height) => {
  const view = await render(
    <LocalVisitGalleryArtwork title="Garden" artist="Artist" photoCount={1} path="garden.jpg" />,
  );
  const image = screen.getByLabelText("Your photo of Garden");
  await fireEvent(image, "load", { source: { width, height } });
  expect(image.props.contentFit).toBe("contain");
  expect(StyleSheet.flatten(image.parent!.props.style).aspectRatio).toBe(width / height);
  await view.rerender(
    <LocalVisitGalleryArtwork title="Garden" artist="Artist" photoCount={1} path="replacement.jpg" />,
  );
  expect(StyleSheet.flatten(screen.getByLabelText("Your photo of Garden").parent!.props.style).aspectRatio).toBe(1);
});
