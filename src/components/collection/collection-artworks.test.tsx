import { fireEvent, render, screen, within } from "@testing-library/react-native";
import type { ComponentProps, ReactNode } from "react";
import { Alert, Dimensions, Text } from "react-native";

import { scheduleRemoval } from "@/lib/collection/pending-removals";

import { CollectionArtworks } from "./collection-artworks";

const mockPush = jest.fn();
jest.mock("expo-router", () => {
  const { Pressable, Text, View } = jest.requireActual("react-native");
  const Passthrough = ({ children }: { children: ReactNode }) => children;
  // The native context menu renders its actions as menu items beside the tile.
  const Menu = ({ children, inline }: { children: ReactNode; inline?: boolean }) => (
    <View accessibilityLabel={inline ? "Menu section" : "Artwork menu"}>{children}</View>
  );
  const MenuAction = ({
    children,
    disabled,
    onPress,
  }: {
    children: string;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <Pressable accessibilityRole="menuitem" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}>
      <Text>{children}</Text>
    </Pressable>
  );
  return {
    useFocusEffect: () => {},
    router: { navigate: jest.fn(), push: (...args: unknown[]) => mockPush(...args) },
    Link: Object.assign(Passthrough, { Trigger: Passthrough, Preview: Passthrough, Menu, MenuAction }),
  };
});
jest.mock("@/lib/collection/pending-removals", () => ({ scheduleRemoval: jest.fn() }));
const mockShare = jest.fn(async (_uri: string, _options: object) => {});
jest.mock("expo-sharing", () => ({
  shareAsync: (uri: string, options: object) => mockShare(uri, options),
}));
jest.mock("@/lib/wall/use-collection-wall", () => ({
  useCollectionWall: () => ({
    signedIn: false,
    draft: { items: [] },
    pieces: [],
  }),
}));
jest.mock("@/lib/files/photos", () => ({
  captureFileUri: (path: string) => `file:///${path}`,
}));

const testWindow = Dimensions.get("window");
afterEach(() => Dimensions.set({ window: testWindow }));

const works = [
  {
    localId: "older",
    owner: "device:test",
    artist: "Alice",
    title: "Garden",
    savedAt: 1,
    photoCount: 3,
    visitCount: 2,
  },
  {
    localId: "newer",
    owner: "device:test",
    artist: "Zora",
    title: "Coast",
    savedAt: 2,
    photoCount: 1,
    visitCount: 1,
  },
] as ComponentProps<typeof CollectionArtworks>["works"];

it("sorts by recent save and preserves artist grouping as an option", async () => {
  await render(<CollectionArtworks works={works} loading={false} error={undefined} search="" />);
  const titles = () =>
    screen
      .getAllByRole("button")
      .map((button) => button.props.accessibilityLabel)
      .filter((label) => label?.includes(", "));
  expect(titles()).toEqual(["Coast, Zora", "Garden, Alice"]);
  expect(screen.getByRole("button", { name: "Recent" })).toBeSelected();
  await fireEvent.press(screen.getByRole("button", { name: "Artist" }));
  expect(titles()).toEqual(["Garden, Alice", "Coast, Zora"]);
  expect(screen.getByRole("button", { name: "Sign in" })).toBeOnTheScreen();
});

it("shows only matching artworks and clears an empty search", async () => {
  const onClearSearch = jest.fn();
  const view = await render(
    <CollectionArtworks
      works={works}
      loading={false}
      error={undefined}
      search="Garden"
      onClearSearch={onClearSearch}
    />,
  );
  expect(screen.getByRole("button", { name: "Garden, Alice" })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Coast, Zora" })).toBeNull();
  await view.rerender(
    <CollectionArtworks
      works={works}
      loading={false}
      error={undefined}
      search="missing"
      onClearSearch={onClearSearch}
    />,
  );
  expect(screen.getByText("No artworks found.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Clear search" }));
  expect(onClearSearch).toHaveBeenCalledTimes(1);
});

it("keeps the collection shell while loading and distinguishes a loaded empty collection", async () => {
  const view = await render(
    <CollectionArtworks works={[]} loading error={undefined} search="" header={<Text>Your collection</Text>} />,
  );
  expect(screen.getByText("Your collection")).toBeOnTheScreen();
  expect(screen.getByRole("progressbar", { name: "Opening collection…" })).toBeOnTheScreen();
  expect(screen.queryByText("No saved artworks yet.")).toBeNull();
  await view.rerender(<CollectionArtworks works={[]} loading={false} error={undefined} search="" />);
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.getByText("No saved artworks yet.")).toBeOnTheScreen();
});

it("replaces ghosts with retry even when a failed query still reports loading", async () => {
  const retry = jest.fn();
  await render(<CollectionArtworks works={[]} loading error={new Error("Read failed")} search="" onRetry={retry} />);
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.getByText("Couldn’t load your collection.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
  expect(retry).toHaveBeenCalledTimes(1);
});

it("files the artist sort by surname without lone-letter headings for a small collection", async () => {
  // A two-column iPhone grid; the test window's text size would show one column.
  Dimensions.set({ window: { width: 402, height: 874, scale: 3, fontScale: 1 } });
  const audit = ["Edward Hopper", "Georges Seurat", "Vincent van Gogh"].map((artist, index) => ({
    ...works[0],
    localId: artist,
    artist,
    title: `Work ${index}`,
    savedAt: index,
  }));
  await render(<CollectionArtworks works={audit} loading={false} error={undefined} search="" />);
  await fireEvent.press(screen.getByRole("button", { name: "Artist" }));
  expect(screen.getAllByRole("button", { name: /^Work/ }).map((tile) => tile.props.accessibilityLabel)).toEqual([
    "Work 2, Vincent van Gogh",
    "Work 0, Edward Hopper",
    "Work 1, Georges Seurat",
  ]);
  expect(screen.queryByRole("header")).toBeNull();
});

describe("a tile's long-press menu", () => {
  const saved = {
    ...works[0],
    owner: "device:test",
    localId: "garden",
    title: "Garden",
    cropPath: "crops/garden.jpg",
  } as (typeof works)[number];
  beforeEach(() => jest.clearAllMocks());

  it("keeps each artwork and its native menu inside one grid cell", async () => {
    Dimensions.set({ window: { width: 402, height: 874, scale: 3, fontScale: 1 } });
    await render(<CollectionArtworks works={works} loading={false} error={undefined} search="" />);

    const coast = screen.getByRole("button", { name: "Coast, Zora" });
    const garden = screen.getByRole("button", { name: "Garden, Alice" });
    for (const tile of [coast, garden]) {
      expect(tile.parent).toHaveStyle({ width: 174 });
      expect(within(tile.parent!).getByLabelText("Artwork menu")).toBeOnTheScreen();
    }
    expect(coast.parent).not.toBe(garden.parent);
  });

  it("offers the saved page's actions, with removal set apart and confirmed first", async () => {
    const alert = jest.spyOn(Alert, "alert");
    await render(<CollectionArtworks works={[saved]} loading={false} error={undefined} search="" />);
    const menu = within(screen.getByLabelText("Artwork menu"));
    await fireEvent.press(menu.getByRole("menuitem", { name: "Share" }));
    expect(mockShare).toHaveBeenCalledWith("file:///crops/garden.jpg", { dialogTitle: "Garden" });
    await fireEvent.press(menu.getByRole("menuitem", { name: "Edit Artwork Details" }));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/identify-artwork", params: { savedId: "garden" } });
    await fireEvent.press(menu.getByRole("menuitem", { name: "Add Photos" }));
    expect(mockPush).toHaveBeenLastCalledWith({
      pathname: "/add-photos",
      params: { draftId: "saved:garden", savedId: "garden", title: "Garden", visitId: undefined },
    });
    await fireEvent.press(menu.getByRole("menuitem", { name: "Link Visit" }));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/link-artwork", params: { savedId: "garden" } });
    expect(menu.queryByRole("menuitem", { name: "Wall Display Options" })).toBeNull();

    const removal = within(screen.getByLabelText("Menu section"));
    await fireEvent.press(removal.getByRole("menuitem", { name: "Remove from Collection…" }));
    expect(scheduleRemoval).not.toHaveBeenCalled();
    alert.mock.calls
      .at(-1)?.[2]
      ?.find((button) => button.style === "destructive")
      ?.onPress?.();
    expect(scheduleRemoval).toHaveBeenCalledWith({ owner: "device:test", localId: "garden", title: "Garden" });
  });

  it("gives VoiceOver the same actions and leaves out sharing without a photo", async () => {
    const account = { ...saved, owner: "account:a", cropPath: null };
    await render(<CollectionArtworks works={[account]} loading={false} error={undefined} search="" />);
    const tile = screen.getByRole("button", { name: "Garden, Alice" });
    expect(tile.props.accessibilityActions.map(({ label }: { label: string }) => label)).toEqual([
      "Edit Artwork Details",
      "Add Photos",
      "Link Visit",
      "Wall Display Options",
      "Remove from Collection…",
    ]);
    expect(screen.getByRole("menuitem", { name: "Share" })).toBeDisabled();
    await fireEvent(tile, "accessibilityAction", { nativeEvent: { actionName: "wallDisplay" } });
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/wall-display", params: { savedId: "garden" } });
  });
});
