import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";

import type { Id } from "../../../convex/_generated/dataModel";
import { ArtistScreen } from "./artist-screen";

const mockPush = jest.fn();
const mockLoadMore = jest.fn();
let mockArtist: unknown;
let mockWorks: { items: unknown[]; done: boolean };
let mockSaved: Map<string, unknown>;
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  useNavigation: () => ({ setOptions: jest.fn() }),
  router: { push: (...args: unknown[]) => mockPush(...args) },
  Link: ({ children }: { children: ReactNode }) => children,
}));
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 116 }));
jest.mock("@/lib/catalog/use-catalog-ready", () => ({
  useCatalogReady: () => ({ ready: true, offline: false, scope: "catalog" }),
}));
jest.mock("@/lib/catalog/use-saved-catalog-works", () => ({ useSavedCatalogWorks: () => mockSaved }));
jest.mock("@/lib/files/photos", () => ({ captureFileUri: (path: string) => `file:///documents/${path}` }));
jest.mock("@/lib/social/use-social-query", () => ({
  useSocialQuery: () => ({ data: mockArtist, loading: mockArtist === undefined, refresh: jest.fn() }),
  useCursorPages: () => ({
    ...mockWorks,
    loading: false,
    canLoadMore: !mockWorks.done,
    loadMore: mockLoadMore,
    refresh: jest.fn(),
  }),
}));

const artistId = "monet" as Id<"artists">;
const savedLilies = {
  localId: "save-1",
  owner: "device:test",
  artworkId: "lilies",
  title: "Water Lilies",
  artist: "Claude Monet",
  cropPath: null,
  cropStorageId: null,
};

beforeEach(() => {
  mockPush.mockClear();
  mockLoadMore.mockClear();
  mockArtist = { artistId, key: "claude monet", name: "Claude Monet", workCount: 214 };
  mockWorks = {
    items: [
      {
        artworkId: "wheat",
        title: "Stacks of Wheat",
        artist: "Claude Monet",
        date: "1890–91",
        institution: "Art Institute of Chicago",
      },
      { artworkId: "lilies", title: "Water Lilies", artist: "Claude Monet", date: "1906" },
    ],
    done: false,
  };
  mockSaved = new Map([["lilies", savedLilies]]);
});

it("shows the artist's work count, your saves of their work, then their catalog works", async () => {
  await render(<ArtistScreen artistId={artistId} />);
  expect(screen.getByRole("header", { name: "Claude Monet" })).toBeOnTheScreen();
  expect(screen.getByLabelText("214 works")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Your saves" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Water Lilies, Claude Monet" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Stacks of Wheat, 1890–91 · Art Institute of Chicago" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/catalog/[artworkId]", params: { artworkId: "wheat" } });
  // A catalog work you saved opens your copy.
  await fireEvent.press(screen.getByRole("button", { name: "Water Lilies, 1906, Saved" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/saved/[savedId]", params: { savedId: "save-1" } });
  await fireEvent.press(screen.getByRole("button", { name: "More works" }));
  expect(mockLoadMore).toHaveBeenCalled();
});

it("leaves out saves by other artists and says when the artist is gone", async () => {
  mockSaved = new Map([["jatte", { ...savedLilies, artworkId: "jatte", artist: "Georges Seurat" }]]);
  const view = await render(<ArtistScreen artistId={artistId} />);
  expect(screen.queryByRole("header", { name: "Your saves" })).toBeNull();
  mockArtist = null;
  await view.rerender(<ArtistScreen artistId={artistId} />);
  expect(screen.getByText("Artist unavailable.")).toBeOnTheScreen();
});
