import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ComponentProps, ReactNode } from "react";
import { Text } from "react-native";

import { CollectionArtworks } from "./collection-artworks";

jest.mock("expo-router", () => ({
  useFocusEffect: () => {},
  router: { navigate: jest.fn() },
  Link: ({ children }: { children: ReactNode }) => children,
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

const works = [
  {
    localId: "older",
    artist: "Alice",
    title: "Garden",
    savedAt: 1,
    photoCount: 3,
    visitCount: 2,
  },
  {
    localId: "newer",
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
  expect(screen.getByRole("checkbox", { name: "Recent" })).toBeChecked();
  await fireEvent.press(screen.getByRole("checkbox", { name: "Artist" }));
  expect(titles()).toEqual(["Garden, Alice", "Coast, Zora"]);
  expect(screen.getByRole("button", { name: "Sign in" })).toBeOnTheScreen();
});

it("shows the matching count and clears an empty search", async () => {
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
  expect(screen.getByText("1 artwork")).toBeOnTheScreen();
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
  expect(screen.getByText("0 artworks")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Clear search" }));
  expect(onClearSearch).toHaveBeenCalledTimes(1);
});

it("keeps the collection shell while loading and distinguishes a loaded empty collection", async () => {
  const view = await render(
    <CollectionArtworks works={[]} loading error={undefined} search="" header={<Text>Your collection</Text>} />,
  );
  expect(screen.getByText("Your collection")).toBeOnTheScreen();
  expect(screen.getByRole("progressbar", { name: "Opening collection…" })).toBeOnTheScreen();
  expect(screen.queryByText("0 artworks")).toBeNull();
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
