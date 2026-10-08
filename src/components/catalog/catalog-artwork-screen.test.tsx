import { act, fireEvent, render, screen } from "@testing-library/react-native";

import type { Id } from "../../../convex/_generated/dataModel";
import { CatalogArtworkScreen } from "./catalog-artwork-screen";

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockResearch = jest.fn();
let mockOffline = false;
let mockArtwork: unknown;
let mockEnrichment: unknown;
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush, back: mockBack }) }));
jest.mock("convex/react", () => ({ ...jest.requireActual("convex/react"), useMutation: () => mockResearch }));
jest.mock("@/lib/audio/use-listening");
jest.mock("@/lib/audio/use-cached-narration-duration", () => ({ useCachedNarrationDuration: () => undefined }));
jest.mock("@/lib/catalog/use-catalog-ready", () => ({
  useCatalogReady: () => ({ ready: !mockOffline, offline: mockOffline, scope: "catalog" }),
}));
jest.mock("@/lib/use-artwork-enrichment", () => ({ useArtworkEnrichment: () => mockEnrichment }));
jest.mock("@/lib/social/use-social-query", () => ({
  useSocialQuery: (_query: never, args: unknown) =>
    args === "skip"
      ? { data: undefined, loading: false, refresh: jest.fn() }
      : { data: mockArtwork, loading: mockArtwork === undefined, refresh: jest.fn() },
}));

const artworkId = "wheat" as Id<"artworks">;
const wheat = {
  artworkId,
  title: "Stacks of Wheat (End of Summer)",
  artist: "Claude Monet",
  artistId: "monet",
  date: "1890–91",
  medium: "Oil on canvas",
  institution: "Art Institute of Chicago",
  thumbnailUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Stacks.jpg?width=330",
};
const told = {
  docentGeneration: 0,
  docent: [{ sentence: "Monet painted about 25 views of the wheat stacks.", factIds: ["f1"] }],
  docentWriting: false,
  factSheet: [{ id: "f1", sourceUrl: "https://www.artic.edu/artworks/64818", sourceLabel: "Art Institute of Chicago" }],
  narrationFacts: [
    { id: "f1", sourceUrl: "https://www.artic.edu/artworks/64818", sourceLabel: "Art Institute of Chicago" },
  ],
  narrationWriting: false,
  narrationAvailable: true,
  narrationOpening: "Stacks of Wheat",
  rightsStatus: "public_domain",
};

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  mockResearch.mockReset().mockResolvedValue(true);
  mockOffline = false;
  mockArtwork = wheat;
  mockEnrichment = told;
});

it("shows a catalog work like a scan's result: picture, details, its story and the audio guide", async () => {
  await render(<CatalogArtworkScreen artworkId={artworkId} />);
  expect(screen.getByLabelText("Stacks of Wheat (End of Summer) by Claude Monet")).toHaveProp("source", [
    { uri: "https://commons.wikimedia.org/wiki/Special:FilePath/Stacks.jpg?width=1280" },
  ]);
  for (const text of [
    "Stacks of Wheat (End of Summer)",
    "Oil on canvas",
    "Art Institute of Chicago",
    "About this work",
  ]) {
    expect(screen.getAllByText(text).length).toBeGreaterThan(0);
  }
  expect(screen.getByText(told.docent[0].sentence)).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Listen to this work" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("link", { name: "Claude Monet" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/artist/[artistId]", params: { artistId: "monet" } });
  expect(mockResearch).not.toHaveBeenCalled();
});

it("researches a work nobody has scanned once, showing loading lines until the run reports", async () => {
  mockEnrichment = { ...told, docent: undefined, factSheet: undefined, narrationFacts: undefined };
  const view = await render(<CatalogArtworkScreen artworkId={artworkId} />);
  await act(async () => {});
  expect(mockResearch).toHaveBeenCalledTimes(1);
  expect(mockResearch).toHaveBeenCalledWith({ artworkId });
  expect(screen.queryByText("Background information isn’t available for this work yet.")).toBeNull();
  // The audio guide waits for a play; only the written story is researched on open.
  expect(screen.getByRole("button", { name: "Listen to this work" })).toBeOnTheScreen();

  // The run claims the work, then ends without finding sources.
  mockEnrichment = { ...(mockEnrichment as object), docentWriting: true, docentGeneration: 1 };
  await view.rerender(<CatalogArtworkScreen artworkId={artworkId} />);
  mockEnrichment = { ...(mockEnrichment as object), docentWriting: false };
  await view.rerender(<CatalogArtworkScreen artworkId={artworkId} />);
  expect(screen.getByText("Background information isn’t available for this work yet.")).toBeOnTheScreen();
  expect(mockResearch).toHaveBeenCalledTimes(1);
});

it.each(["before", "after"])(
  "finishes loading when an empty run completes %s the research response, without a writing update",
  async (order) => {
    let resolveResearch!: (started: boolean) => void;
    mockResearch.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveResearch = resolve;
        }),
    );
    mockEnrichment = { ...told, docent: undefined, factSheet: undefined, narrationFacts: undefined };
    const view = await render(<CatalogArtworkScreen artworkId={artworkId} />);
    if (order === "after") await act(async () => resolveResearch(true));
    mockEnrichment = { ...(mockEnrichment as object), docentGeneration: 1 };
    await view.rerender(<CatalogArtworkScreen artworkId={artworkId} />);
    if (order === "before") await act(async () => resolveResearch(true));
    expect(screen.getByText("Background information isn’t available for this work yet.")).toBeOnTheScreen();
    expect(screen.queryByRole("progressbar", { name: "Loading artwork information…" })).toBeNull();
    expect(mockResearch).toHaveBeenCalledTimes(1);
  },
);

it("says when a work has no public-domain picture or is no longer in the catalog", async () => {
  mockArtwork = { ...wheat, thumbnailUrl: undefined };
  const view = await render(<CatalogArtworkScreen artworkId={artworkId} />);
  expect(screen.getByText("No public-domain image")).toBeOnTheScreen();
  mockArtwork = null;
  await view.rerender(<CatalogArtworkScreen artworkId={artworkId} />);
  expect(screen.getByText("Artwork unavailable.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Go back" }));
  expect(mockBack).toHaveBeenCalled();
  mockOffline = true;
  await view.rerender(<CatalogArtworkScreen artworkId={artworkId} />);
  expect(screen.getByText("You’re offline.")).toBeOnTheScreen();
});
