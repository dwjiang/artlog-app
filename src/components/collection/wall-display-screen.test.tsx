import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import { Gallery } from "@/constants/theme";
import { insertSavedWork } from "@/db/repos/saved-works";

import { WallDisplayScreen } from "./wall-display-screen";

let mockWall: Partial<ReturnType<typeof import("@/lib/wall/use-collection-wall").useCollectionWall>> = {
  pieces: [],
  signedIn: true,
};
jest.mock("@/lib/wall/use-collection-wall", () => ({
  useCollectionWall: () => mockWall,
}));
jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
jest.mock("@/lib/files/photos", () => ({
  captureFileUri: (path: string) => `file:///documents/${path}`,
}));
jest.mock("./photo-visibility", () => ({ PhotoVisibility: () => null }));
const mockSetOptions = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: jest.fn() }),
  useNavigation: () => ({ setOptions: mockSetOptions }),
}));
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 116 }));

const layout = {
  x: 0.05,
  y: 0.06,
  width: 0.52,
  layer: 0,
  frame: "black" as const,
};
beforeAll(async () => {
  await insertSavedWork({
    localId: "lilies",
    savedAt: 1,
    title: "Water Lilies",
    artist: "Claude Monet",
    cropPath: "crops/lilies.jpg",
    syncedAt: 1,
  });
  await insertSavedWork({
    localId: "unsynced",
    savedAt: 2,
    title: "Haystacks",
    artist: "Claude Monet",
    cropPath: "crops/haystacks.jpg",
  });
});
beforeEach(() => {
  jest.clearAllMocks();
});

it("explains why a hung work cannot share its note until the note has synced", async () => {
  mockWall = {
    signedIn: true,
    pieces: [],
    draft: {
      color: "#FCFCF9",
      items: [{ placementId: "p", saveLocalId: "lilies", layout }],
    },
    setError: jest.fn(),
  };
  await render(<WallDisplayScreen savedId="lilies" />);
  expect(await screen.findByRole("switch", { name: "Show note on public wall" })).toBeDisabled();
  expect(screen.getByText("Add a note and let it sync before sharing it.")).toBeOnTheScreen();
});

it.each([
  ["Carved Leaf", "carved-leaf"],
  ["Aged Silver", "aged-silver"],
  ["Satin Silver & Linen", "satin-silver-linen"],
])("saves %s for the hung placement", async (name, frame) => {
  const setLayoutDraft = jest.fn();
  const publishLayout = jest.fn().mockResolvedValue(undefined);
  mockWall = {
    signedIn: true,
    pieces: [],
    draft: {
      color: "#FCFCF9",
      items: [{ placementId: "p", saveLocalId: "lilies", layout }],
    },
    repository: { setLayoutDraft, publishLayout } as never,
    setError: jest.fn(),
  };
  await render(<WallDisplayScreen savedId="lilies" />);
  await fireEvent.press(await screen.findByRole("button", { name }));
  expect(setLayoutDraft).toHaveBeenCalledWith(
    expect.objectContaining({
      items: [
        expect.objectContaining({
          placementId: "p",
          layout: expect.objectContaining({ frame }),
        }),
      ],
    }),
  );
  expect(publishLayout).toHaveBeenCalledTimes(1);
});

it("previews the selected artwork and offers the approved frames without preset sizes", async () => {
  mockWall = {
    signedIn: true,
    pieces: [
      {
        localId: "p",
        layout,
        cropPath: "crops/lilies.jpg",
        artwork: {
          title: "Water Lilies",
          artist: "Claude Monet",
          media: { kind: "placeholder", width: 1, height: 1 },
        },
      },
    ],
    draft: {
      color: "#FCFCF9",
      items: [{ placementId: "p", saveLocalId: "lilies", layout }],
    },
    setError: jest.fn(),
  };
  await render(<WallDisplayScreen savedId="lilies" />);
  expect(
    await screen.findByRole("image", {
      name: "Water Lilies, Matte Black frame preview",
    }),
  ).toBeOnTheScreen();
  for (const name of [
    "Natural Oak",
    "Sculpted Walnut",
    "Ebonized Oak",
    "Antique Gold",
    "Carved Leaf",
    "Aged Silver",
    "Satin Silver & Linen",
    "Matte Black",
    "White Float",
    "Museum Mat",
    "Fine Scroll",
  ]) {
    expect(screen.getByRole("button", { name })).toBeOnTheScreen();
  }
  for (const name of [
    "S",
    "M",
    "L",
    "No frame",
    "Rococo",
    "Gilt",
    "Oak",
    "Walnut",
    "Black",
    "Mat",
    "Baroque Gold",
    "Acanthus",
  ]) {
    expect(screen.queryByRole("button", { name })).toBeNull();
  }
  expect(screen.getByRole("header", { name: "Water Lilies" })).toBeOnTheScreen();
});

it("names the artwork in the bar only while its heading is scrolled under the bar", async () => {
  mockWall = {
    signedIn: true,
    pieces: [],
    draft: {
      color: "#FCFCF9",
      items: [{ placementId: "p", saveLocalId: "lilies", layout }],
    },
    setError: jest.fn(),
  };
  await render(<WallDisplayScreen savedId="lilies" />);
  const heading = await screen.findByRole("header", { name: "Water Lilies" });
  await fireEvent(heading, "layout", { nativeEvent: { layout: { x: 20, y: 240, width: 362, height: 40 } } });
  const scrollTo = (y: number) => fireEvent.scroll(heading, { nativeEvent: { contentOffset: { x: 0, y } } });
  await scrollTo(-116);
  await scrollTo(163);
  expect(mockSetOptions).toHaveBeenCalledWith({ title: "Water Lilies" });
  expect(mockSetOptions).not.toHaveBeenCalledWith({ headerTitleStyle: expect.anything() });
  await scrollTo(164);
  expect(mockSetOptions).toHaveBeenLastCalledWith({ headerTitleStyle: { color: Gallery.ink } });
  await scrollTo(0);
  expect(mockSetOptions).toHaveBeenLastCalledWith({ headerTitleStyle: { color: "transparent" } });
});

it("tells the owner when the artwork is not on the wall", async () => {
  mockWall = {
    signedIn: true,
    pieces: [],
    draft: { color: "#FCFCF9", items: [] },
    setError: jest.fn(),
  };
  await render(<WallDisplayScreen savedId="lilies" />);
  expect(await screen.findByText("This artwork is not on your wall.")).toBeOnTheScreen();
});

it("re-reads the wall for a synced work so note eligibility reflects the latest sync", async () => {
  const refresh = jest.fn().mockResolvedValue(undefined);
  const acknowledged = {
    color: "#FCFCF9",
    items: [
      {
        placementId: "p",
        saveLocalId: "lilies",
        layout,
        itemId: "i",
        noteVisible: false,
        noteEligible: false,
      },
    ],
  };
  mockWall = {
    signedIn: true,
    pieces: [],
    draft: { color: "#FCFCF9", items: acknowledged.items },
    acknowledged: acknowledged as never,
    refresh,
    setError: jest.fn(),
  };
  const view = await render(<WallDisplayScreen savedId="lilies" />);
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  await view.rerender(<WallDisplayScreen savedId="unsynced" />);
  expect(await screen.findByRole("header", { name: "Haystacks" })).toBeOnTheScreen();
  expect(refresh).toHaveBeenCalledTimes(1);
});
