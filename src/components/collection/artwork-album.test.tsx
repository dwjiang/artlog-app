import { fireEvent, render, screen, within } from "@testing-library/react-native";
import { router } from "expo-router";
import { Dimensions } from "react-native";

import type { SavedWork } from "@/db/schema";

import { ArtworkAlbum } from "./artwork-album";

const initialPhotos = Array.from({ length: 4 }, (_, index) => ({
  localId: `photo-${index}`,
  owner: "device:guest",
  savedLocalId: "work",
  kind: "full",
  path: `photo-${index}.jpg`,
  caption: `Museum view ${index + 1}`,
}));
let mockPhotos = initialPhotos;
let mockPhotosUpdatedAt: Date | undefined;
let mockPhotosError: Error | undefined;
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@/lib/files/photos", () => ({
  captureFileUri: (path: string) => `file:///${path}`,
}));
jest.mock("@/db/repos/artwork-album", () => ({
  selectArtworkPhotos: () => "photos",
  selectArtworkEncounters: () => "encounters",
  unlinkArtworkVisit: jest.fn(),
}));
jest.mock("@/db/repos/visits", () => ({ listVisits: () => "visits" }));
jest.mock("drizzle-orm/expo-sqlite", () => ({
  useLiveQuery: (query: string) => ({
    data: query === "photos" ? mockPhotos : [],
    updatedAt: mockPhotosUpdatedAt,
    error: mockPhotosError,
  }),
}));
const work = {
  localId: "work",
  owner: "device:guest",
  title: "Water Lilies",
  artist: "Claude Monet",
} as SavedWork;
beforeEach(() => {
  jest.clearAllMocks();
  mockPhotos = initialPhotos;
  mockPhotosUpdatedAt = undefined;
  mockPhotosError = undefined;
});

it("selects a thumbnail and edits that photo", async () => {
  await render(<ArtworkAlbum work={work} />);
  expect(screen.getByLabelText("Photo thumbnails")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Show full photo 3" }));
  expect(screen.getByRole("button", { name: "Show full photo 3", selected: true })).toBeOnTheScreen();
  expect(screen.queryByText("Museum view 3")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Edit full photo 3" }));
  expect(router.push).toHaveBeenCalledWith({
    pathname: "/photo-details",
    params: { savedId: "work", photoId: "photo-2" },
  });
});

it("keeps captions out of the gallery while photo editing stays available", async () => {
  await render(<ArtworkAlbum work={work} />);
  expect(screen.getByRole("header", { name: "Water Lilies" })).toBeOnTheScreen();
  expect(screen.queryByText("Museum view 1")).toBeNull();
  expect(screen.queryByText("Museum view 2")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Show full photo 2" }));
  expect(screen.queryByText("Museum view 1")).toBeNull();
  expect(screen.queryByText("Museum view 2")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Edit full photo 2" }));
  expect(router.push).toHaveBeenCalledWith({
    pathname: "/photo-details",
    params: { savedId: "work", photoId: "photo-1" },
  });
});

it("waits for the photo read before showing an empty album and distinguishes a read failure", async () => {
  mockPhotos = [];
  const view = await render(<ArtworkAlbum work={work} />);
  expect(screen.getByLabelText("Loading photos…")).toBeOnTheScreen();
  expect(screen.queryByText("No photos yet.")).toBeNull();
  mockPhotosUpdatedAt = new Date();
  await view.rerender(<ArtworkAlbum work={work} />);
  expect(screen.getByText("No photos yet.")).toBeOnTheScreen();
  mockPhotosError = new Error("Read failed");
  await view.rerender(<ArtworkAlbum work={work} />);
  expect(screen.getByRole("alert")).toHaveTextContent(/Photos couldn’t load\./);
  expect(screen.queryByText("No photos yet.")).toBeNull();
});

it("moves to the last remaining photo after photos are deleted, and lets the first remaining thumbnail be selected", async () => {
  const view = await render(<ArtworkAlbum work={work} />);
  await fireEvent.press(screen.getByRole("button", { name: "Show full photo 4" }));
  expect(screen.getByRole("button", { name: "Show full photo 4", selected: true })).toBeOnTheScreen();
  mockPhotos = initialPhotos.slice(0, 2);
  await view.rerender(<ArtworkAlbum work={work} />);
  expect(screen.getByRole("button", { name: "Show full photo 2", selected: true })).toBeOnTheScreen();
  expect(screen.queryByText("Museum view 2")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Show full photo 1" }));
  expect(screen.getByRole("button", { name: "Show full photo 1", selected: true })).toBeOnTheScreen();
  expect(screen.queryByText("Museum view 1")).toBeNull();
  expect(screen.getByRole("button", { name: "Show full photo 1" })).toBeSelected();
});

it("resets the photo position when an emptied album receives a new photo", async () => {
  const view = await render(<ArtworkAlbum work={work} />);
  await fireEvent.press(screen.getByRole("button", { name: "Show full photo 2" }));
  mockPhotos = [];
  await view.rerender(<ArtworkAlbum work={work} />);
  expect(screen.queryByRole("button", { name: /^Show \w+ photo/ })).toBeNull();
  mockPhotos = initialPhotos.slice(0, 1);
  await view.rerender(<ArtworkAlbum work={work} />);
  expect(screen.queryByText("Museum view 1")).toBeNull();
  expect(screen.queryByText("1 / 1")).toBeNull();
  expect(screen.queryByRole("button", { name: "Show full photo 2" })).toBeNull();
});

it("opens the wall photo that was tapped after the album loads", async () => {
  mockPhotos = [];
  const view = await render(<ArtworkAlbum work={work} photoId="photo-2" />);
  mockPhotos = initialPhotos;
  await view.rerender(<ArtworkAlbum work={work} photoId="photo-2" />);
  expect(screen.getByRole("button", { name: "Show full photo 3", selected: true })).toBeOnTheScreen();
  expect(screen.queryByText("Museum view 3")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Show full photo 2" }));
  expect(screen.getByRole("button", { name: "Show full photo 2", selected: true })).toBeOnTheScreen();
});

it("falls back to the first available photo if the requested photo was removed", async () => {
  await render(<ArtworkAlbum work={work} photoId="removed" />);
  expect(screen.getByRole("button", { name: "Show full photo 1", selected: true })).toBeOnTheScreen();
});

it("adds photos to the displayed artwork from an empty album", async () => {
  mockPhotos = [];
  mockPhotosUpdatedAt = new Date();
  await render(<ArtworkAlbum work={work} />);
  await fireEvent.press(screen.getByRole("button", { name: "Add photos" }));
  expect(router.push).toHaveBeenCalledWith({
    pathname: "/add-photos",
    params: {
      draftId: "saved:work",
      savedId: "work",
      title: "Water Lilies",
      visitId: undefined,
    },
  });
});

it("keeps the selected visit for new photos and offers the complete album", async () => {
  mockPhotosUpdatedAt = new Date();
  await render(<ArtworkAlbum work={work} visitId="visit-a" />);
  await fireEvent.press(screen.getByRole("button", { name: "Add photos" }));
  expect(router.push).toHaveBeenCalledWith({
    pathname: "/add-photos",
    params: {
      draftId: "saved:work",
      savedId: "work",
      title: "Water Lilies",
      visitId: "visit-a",
    },
  });
  await fireEvent.press(screen.getByRole("button", { name: "View all photos" }));
  expect(screen.queryByText("Museum view 1")).toBeNull();
  expect(screen.queryByText("No photos from this visit yet.")).toBeNull();
});

it("keeps photo-scope controls ahead of changing photo content and mounted for an empty visit", async () => {
  mockPhotosUpdatedAt = new Date();
  await render(<ArtworkAlbum work={work} visitId="visit-a" />);
  const visit = screen.getByRole("button", { name: "This visit" });
  const all = screen.getByRole("button", { name: "All photos" });
  expect(screen.getAllByRole("button").slice(0, 2)).toEqual([visit, all]);
  await fireEvent.press(all);
  expect(screen.queryByText("Museum view 1")).toBeNull();
  expect(screen.getAllByRole("button").slice(0, 2)).toEqual([visit, all]);
  await fireEvent.press(visit);
  expect(screen.getByText("No photos from this visit yet.")).toBeOnTheScreen();
  expect(screen.getAllByRole("button").slice(0, 2)).toEqual([visit, all]);
});

it("shows the museum on its own line under the medium, falling back to the visit venue", async () => {
  const view = await render(
    <ArtworkAlbum work={{ ...work, medium: "Oil on canvas", institution: "Musée d'Orsay", venueName: "The Met" }} />,
  );
  expect(screen.getByText("Oil on canvas")).toBeOnTheScreen();
  expect(screen.getByText("Musée d'Orsay")).toBeOnTheScreen();
  expect(screen.queryByText("The Met")).toBeNull();
  await view.rerender(<ArtworkAlbum work={{ ...work, institution: "", venueName: "The Met" }} />);
  expect(screen.getByText("The Met")).toBeOnTheScreen();
});

it("swipes full photos and keeps the filmstrip on the same page", async () => {
  await render(<ArtworkAlbum work={{ ...work, cropPath: "cropped.jpg" }} />);
  await fireEvent(screen.getByLabelText("Artwork photos"), "momentumScrollEnd", {
    nativeEvent: {
      contentOffset: { x: Dimensions.get("window").width },
      layoutMeasurement: { width: Dimensions.get("window").width },
    },
  });
  expect(screen.getByRole("button", { name: "Show full photo 2" })).toBeSelected();
  expect(screen.queryByText("Museum view 2")).toBeNull();
  expect(screen.getByLabelText("full photo 2 of Water Lilies").props.source).toEqual([{ uri: "file:///photo-1.jpg" }]);
  expect(screen.getByLabelText("full photo 2 of Water Lilies").props.contentFit).toBe("contain");
});

it("fits the photo area to the loaded image and updates its height when switching photos", async () => {
  await render(<ArtworkAlbum work={work} />);
  const { width, height } = Dimensions.get("window");
  await fireEvent(screen.getByLabelText("full photo 1 of Water Lilies"), "load", {
    nativeEvent: { source: { width: 1500, height: 1000 } },
  });
  expect(screen.getByLabelText("Artwork photos")).toHaveStyle({ height: (width - 40) / 1.5 });
  await fireEvent(screen.getByLabelText("full photo 2 of Water Lilies"), "load", {
    nativeEvent: { source: { width: 800, height: 1200 } },
  });
  expect(screen.getByLabelText("Artwork photos")).toHaveStyle({ height: (width - 40) / 1.5 });
  await fireEvent.press(screen.getByRole("button", { name: "Show full photo 2" }));
  expect(screen.getByLabelText("Artwork photos")).toHaveStyle({
    height: Math.min((width - 40) * 1.5, width * 1.2, height * 0.52),
  });
  await fireEvent.press(screen.getByRole("button", { name: "Show full photo 1" }));
  expect(screen.getByLabelText("Artwork photos")).toHaveStyle({ height: (width - 40) / 1.5 });
});

it("adds from the thumbnail strip and crops the selected photo after swiping", async () => {
  await render(<ArtworkAlbum work={work} />);
  await fireEvent.press(within(screen.getByLabelText("Photo thumbnails")).getByRole("button", { name: "Add photos" }));
  expect(router.push).toHaveBeenCalledWith({
    pathname: "/add-photos",
    params: { draftId: "saved:work", savedId: "work", title: "Water Lilies", visitId: undefined },
  });
  await fireEvent.press(screen.getByRole("button", { name: "Adjust crop for full photo 1" }));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: "/adjust-crop",
    params: { savedId: "work", photoId: "photo-0" },
  });
  await fireEvent(screen.getByLabelText("Artwork photos"), "momentumScrollEnd", {
    nativeEvent: { contentOffset: { x: Dimensions.get("window").width * 2 } },
  });
  expect(screen.queryByRole("button", { name: "Adjust crop for full photo 1" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Adjust crop for full photo 3" }));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: "/adjust-crop",
    params: { savedId: "work", photoId: "photo-2" },
  });
});

it("keeps the add tile available for a single-photo album", async () => {
  mockPhotos = initialPhotos.slice(0, 1);
  await render(<ArtworkAlbum work={work} />);
  const thumbnails = within(screen.getByLabelText("Photo thumbnails"));
  expect(thumbnails.getAllByRole("button").map((button) => button.props.accessibilityLabel)).toEqual([
    "Show full photo 1",
    "Add photos",
  ]);
  expect(screen.queryByText("1 / 1")).toBeNull();
  await fireEvent.press(thumbnails.getByRole("button", { name: "Add photos" }));
  expect(router.push).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/add-photos" }));
});

it("does not offer crop editing for unavailable photos or wall labels", async () => {
  mockPhotos = [
    { ...initialPhotos[0], path: "" },
    { ...initialPhotos[1], kind: "label" },
    { ...initialPhotos[2], kind: "detail" },
  ];
  await render(<ArtworkAlbum work={work} />);
  expect(screen.queryByRole("button", { name: /^Adjust crop/ })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Show label photo 2" }));
  expect(screen.queryByRole("button", { name: /^Adjust crop/ })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Show detail photo 3" }));
  await fireEvent.press(screen.getByRole("button", { name: "Adjust crop for detail photo 3" }));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: "/adjust-crop",
    params: { savedId: "work", photoId: "photo-2" },
  });
  await fireEvent(screen.getByLabelText("detail photo 3 of Water Lilies"), "error", {
    nativeEvent: { error: "Missing image" },
  });
  expect(screen.queryByRole("button", { name: /^Adjust crop/ })).toBeNull();
});

it("adds from the thumbnail strip within the selected visit scope", async () => {
  mockPhotos = initialPhotos.map((photo) => ({ ...photo, visitLocalId: "visit-a" }));
  await render(<ArtworkAlbum work={work} visitId="visit-a" />);
  await fireEvent.press(screen.getByRole("button", { name: "Add photos" }));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: "/add-photos",
    params: { draftId: "saved:work", savedId: "work", title: "Water Lilies", visitId: "visit-a" },
  });
  await fireEvent.press(screen.getByRole("button", { name: "All photos" }));
  await fireEvent.press(screen.getByRole("button", { name: "Add photos" }));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: "/add-photos",
    params: { draftId: "saved:work", savedId: "work", title: "Water Lilies", visitId: undefined },
  });
});
