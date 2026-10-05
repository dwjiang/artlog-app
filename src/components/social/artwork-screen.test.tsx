import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { getFunctionName } from "convex/server";
import { AccessibilityInfo, DeviceEventEmitter, Dimensions, ScrollView, Text, type HostInstance } from "react-native";

import { Gallery } from "@/constants/theme";
import type { SharedArtwork } from "@/lib/social/types";

import { ArtworkScreen } from "./artwork-screen";

const mockQuery = jest.fn();
let mockSession = {
  key: "viewer",
  status: "ready",
  offline: false,
  token: "private-token",
};
jest.mock("@/lib/social/use-social-session", () => ({
  useSocialSession: () => mockSession,
}));
jest.mock("@/lib/social/use-social-query", () => ({
  useSocialQuery: (...args: unknown[]) => mockQuery(...args),
}));
jest.mock("./report-toolbar", () => ({ ReportToolbar: () => null }));
jest.mock("@/components/settings/account-section", () => ({
  AccountSection: () => null,
}));
const mockSetOptions = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useNavigation: () => ({ setOptions: mockSetOptions }),
}));
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 116 }));
jest.mock("expo-image", () => ({
  Image: (props: object) => {
    const { View } = jest.requireActual("react-native");
    return <View accessibilityRole="image" {...props} />;
  },
}));

const media = (photoLocalId: string): Extract<NonNullable<SharedArtwork["photos"]>[number], { kind: "photo" }> => ({
  kind: "photo",
  width: 200,
  height: 400,
  reference: {
    kind: "sharedVisit",
    postId: "post-a",
    itemId: "art-a" as never,
    photoLocalId,
  },
});
let artwork: SharedArtwork;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_CONVEX_SITE_URL = "https://test.convex.site";
  mockSession = {
    key: "viewer",
    status: "ready",
    offline: false,
    token: "private-token",
  };
  artwork = {
    itemId: "art-a" as never,
    artwork: {
      title: "Starry Night",
      artist: "Vincent van Gogh",
      date: "1889",
      medium: "Oil on canvas",
      media: media("unselected-cover"),
    },
    photos: [media("selected-a"), media("selected-b")],
  };
  mockQuery.mockImplementation((query, args) => ({
    data: args === "skip" ? undefined : getFunctionName(query) === "sharedVisits:getArtwork" ? artwork : null,
    refresh: jest.fn(),
  }));
});

it("navigates only the selected shared photos and preserves authenticated media scope", async () => {
  await render(<ArtworkScreen kind="visit" postId="post-a" itemId="art-a" />);
  expect(screen.getByText("1 / 2")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Add photos" })).toBeNull();
  expect(screen.queryByRole("button", { name: /^Adjust crop/ })).toBeNull();
  expect(screen.getByRole("button", { name: "Show photo 1" })).toBeSelected();
  await fireEvent.press(screen.getByRole("button", { name: "Show photo 2" }));
  expect(screen.getByRole("button", { name: "Show photo 2" })).toBeSelected();
  await fireEvent.press(screen.getByRole("button", { name: "Show photo 1" }));
  expect(screen.getByRole("button", { name: "Show photo 1" })).toBeSelected();
  const photos = [1, 2].map((index) => screen.getByRole("image", { name: `Starry Night, photo ${index}` }));
  expect(photos.map((photo) => new URL(photo.props.source.uri).searchParams.get("photoLocalId"))).toEqual([
    "selected-a",
    "selected-b",
  ]);
  expect(photos.every((photo) => photo.props.source.headers.Authorization === "Bearer private-token")).toBe(true);
  expect(photos.every((photo) => photo.props.cachePolicy === "memory")).toBe(true);
  expect(screen.getByText(/Vincent van Gogh/)).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Starry Night" })).toBeOnTheScreen();
});

it("names the artwork in the bar only while its title is scrolled under the bar", async () => {
  // Native layout puts the title 500–540 pt down the scroll content.
  const nativeScroll = {} as HostInstance;
  const scrollRef = jest.spyOn(ScrollView.prototype, "getNativeScrollRef").mockReturnValue(nativeScroll);
  const measure = jest.spyOn(Text.prototype, "measureLayout").mockImplementation((relativeTo, onSuccess) => {
    if (relativeTo === nativeScroll) onSuccess(20, 500, 362, 40);
  });
  try {
    await render(<ArtworkScreen kind="visit" postId="post-a" itemId="art-a" />);
    const title = screen.getByRole("header", { name: "Starry Night" });
    await fireEvent(title, "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 362, height: 40 } } });
    const scrollTo = (y: number) => fireEvent.scroll(title, { nativeEvent: { contentOffset: { x: 0, y } } });
    await scrollTo(-116);
    await scrollTo(423);
    expect(mockSetOptions).toHaveBeenCalledWith({ title: "Starry Night" });
    expect(mockSetOptions).not.toHaveBeenCalledWith({ headerTitleStyle: expect.anything() });
    await scrollTo(424);
    expect(mockSetOptions).toHaveBeenLastCalledWith({ headerTitleStyle: { color: Gallery.ink } });
    await scrollTo(-116);
    expect(mockSetOptions).toHaveBeenLastCalledWith({ headerTitleStyle: { color: "transparent" } });
  } finally {
    scrollRef.mockRestore();
    measure.mockRestore();
  }
});

it("resets the gallery when a shared photo is removed and hides it when the session becomes unavailable", async () => {
  const view = await render(<ArtworkScreen kind="visit" postId="post-a" itemId="art-a" />);
  await fireEvent.press(screen.getByRole("button", { name: "Show photo 2" }));
  artwork = { ...artwork, photos: [media("selected-a")] };
  await view.rerender(<ArtworkScreen kind="visit" postId="post-a" itemId="art-a" />);
  expect(screen.queryByText("1 / 1")).toBeNull();
  expect(screen.queryByRole("image", { name: "Starry Night, photo 2" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Show photo 2" })).toBeNull();
  expect(screen.getByRole("image", { name: "Starry Night, photo 1" })).toBeOnTheScreen();
  mockSession = { ...mockSession, key: "new-account", status: "loading" };
  await view.rerender(<ArtworkScreen kind="visit" postId="post-a" itemId="art-a" />);
  expect(screen.queryByText("Vincent van Gogh")).toBeNull();
  expect(screen.queryByRole("button", { name: "Show photo 2" })).toBeNull();
});

it("does not replace an empty shared-photo selection with another artwork image", async () => {
  artwork = { ...artwork, photos: [] };
  await render(<ArtworkScreen kind="visit" postId="post-a" itemId="art-a" />);
  expect(screen.getByText("No photos shared for this artwork.")).toBeOnTheScreen();
  expect(screen.queryByRole("image", { name: "Starry Night, photo 1" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Show photo 2" })).toBeNull();
});

it("respects a live Reduce Motion change when navigating shared photos", async () => {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
  jest
    .spyOn(AccessibilityInfo, "addEventListener")
    .mockImplementation((event, listener) => DeviceEventEmitter.addListener(event, listener));
  const scroll = jest.spyOn(ScrollView.prototype, "scrollTo");
  try {
    await render(<ArtworkScreen kind="visit" postId="post-a" itemId="art-a" />);
    await act(() => DeviceEventEmitter.emit("reduceMotionChanged", true));
    await fireEvent.press(screen.getByRole("button", { name: "Show photo 2" }));
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ animated: false }));
    scroll.mockClear();
    await act(() => DeviceEventEmitter.emit("reduceMotionChanged", false));
    await fireEvent.press(screen.getByRole("button", { name: "Show photo 1" }));
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ animated: true }));
    await screen.unmount();
  } finally {
    jest.restoreAllMocks();
  }
});

it("opens full photos from a public wall instead of reusing its cropped preview", async () => {
  const wallPhoto = (photoLocalId: string) => ({
    ...media(photoLocalId),
    reference: { kind: "wallItem", itemId: "wall-item", photoLocalId },
  });
  const full = wallPhoto("original");
  mockQuery.mockImplementation((query, args) => ({
    data:
      args !== "skip" && getFunctionName(query) === "walls:getArtwork"
        ? {
            ...artwork,
            profileId: "owner",
            layout: { frame: "gilt" },
            artwork: { ...artwork.artwork, media: { ...full, reference: { ...full.reference, variant: "crop" } } },
            photos: [full, wallPhoto("shared-detail")],
          }
        : undefined,
    refresh: jest.fn(),
  }));
  await render(<ArtworkScreen kind="wall" itemId="wall-item" />);
  const original = screen.getByRole("image", { name: "Starry Night, photo 1" });
  expect(new URL(original.props.source.uri).searchParams.get("variant")).toBeNull();
  expect(new URL(original.props.source.uri).searchParams.get("photoLocalId")).toBe("original");
  await fireEvent.press(screen.getByRole("button", { name: "Show photo 2" }));
  expect(screen.getByRole("button", { name: "Show photo 2" })).toBeSelected();
});

it("keeps shared-photo thumbnails just below landscape and portrait images", async () => {
  artwork = {
    ...artwork,
    photos: [
      { ...media("landscape"), width: 1500, height: 1000 },
      { ...media("portrait"), width: 800, height: 1200 },
    ],
  };
  await render(<ArtworkScreen kind="visit" postId="post-a" itemId="art-a" />);
  const { width, height } = Dimensions.get("window");
  expect(screen.getByLabelText("Photo thumbnails")).toBeOnTheScreen();
  expect(screen.getByLabelText("Artwork photos")).toHaveStyle({ height: (width - 40) / 1.5 });
  await fireEvent.press(screen.getByRole("button", { name: "Show photo 2" }));
  expect(screen.getByLabelText("Artwork photos")).toHaveStyle({
    height: Math.min((width - 40) * 1.5, width * 1.2, height * 0.52),
  });
});
