import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { LocalVisitGalleryArtwork } from "./visit-gallery";
jest.mock("@/lib/files/photos", () => ({
  captureFileUri: (path: string) => `file:///${path}`,
}));
jest.mock("expo-image", () => ({
  Image: (props: object) => {
    const { View } = jest.requireActual("react-native");
    return <View {...props} />;
  },
}));
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
