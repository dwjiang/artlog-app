import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react-native";
import { ConvexError } from "convex/values";
import type { ReactNode } from "react";
import { Image, ScrollView, Text } from "react-native";

import { addArtworkPhoto } from "@/db/repos/artwork-album";
import {
  insertSavedWork,
  getSavedWork,
  replaceSavedCrop,
  upsertFromRemote,
  updatePhotoTransfer,
} from "@/db/repos/saved-works";
import { getSetting, setSetting } from "@/db/repos/settings";
import type { SavedWork } from "@/db/schema";
import { switchOwner } from "@/lib/account/owner-store";
import { scheduleRemoval, useRemovedWorkIds } from "@/lib/collection/pending-removals";
import { createLocalWallRepository } from "@/lib/wall/local-wall-repository";
import { useCollectionWall } from "@/lib/wall/use-collection-wall";
import { wallAspect, type WallPiece, type WallLayout } from "@/lib/wall/wall-layout";
import type { OwnerWall, WallTransport } from "@/lib/wall/wall-transport";

import { CollectionWall } from "./collection-wall";

jest.mock("expo-crypto", () => ({
  randomUUID: () => jest.requireActual("node:crypto").randomUUID(),
}));
jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
jest.mock("@/lib/account/collection-sync", () => ({
  flushCollectionMedia: async () => {},
}));
const mockPush = jest.fn();
let mockToken: string | null = "token";
const mockTransport = {
  getMine: jest.fn(),
  setLayout: jest.fn(),
  setNoteVisibility: jest.fn(),
} satisfies WallTransport;
jest.mock("@convex-dev/auth/react", () => ({ useAuthToken: () => mockToken }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));
jest.mock("expo-network", () => ({
  getNetworkStateAsync: async () => ({
    isConnected: true,
    isInternetReachable: true,
  }),
}));
jest.mock("@/lib/wall/wall-transport", () => ({
  createWallTransport: () => mockTransport,
}));
jest.mock("@/lib/files/photos", () => ({
  captureFileUri: (path: string) => `file:///documents/${path}`,
}));
jest.mock("./wall-gallery", () => {
  const { View, Pressable, Text } = jest.requireActual("react-native");
  return {
    WallArtwork: () => null,
    WallGallery: ({
      pieces,
      onSelect,
      onMove,
      onDeselect,
      selectedId,
      editing,
      children,
    }: {
      pieces: WallPiece[];
      onMove: (id: string, layout: WallLayout) => void;
      onDeselect: () => void;
      selectedId?: string;
      editing: boolean;
      onSelect: (piece: unknown) => void;
      children: ReactNode;
    }) => (
      <View>
        {editing && selectedId && (
          <Pressable accessibilityRole="button" accessibilityLabel="Deselect artwork" onPress={onDeselect} />
        )}
        {pieces.map((piece) => (
          <Pressable
            key={piece.localId}
            accessibilityRole="button"
            onPress={() => onSelect(piece)}
            onAccessibilityAction={({ nativeEvent: { actionName } }: { nativeEvent: { actionName: string } }) => {
              if (!editing) return;
              onMove(piece.localId, {
                ...piece.layout,
                ...(actionName === "increment" ? { width: piece.layout.width + 0.04 } : { x: piece.layout.x + 0.025 }),
              });
            }}
          >
            <Text>{piece.artwork.title}</Text>
          </Pressable>
        ))}
        {children}
      </View>
    ),
  };
});
jest.mock("./wall-profile-sheet", () => {
  const { Text } = jest.requireActual("react-native");
  return {
    WallProfileSheet: () => <Text accessibilityRole="header">Your public wall</Text>,
  };
});
jest.mock("@expo/ui", () => ({
  ...jest.requireActual("@/__mocks__/@expo/ui"),
  Picker: Object.assign(() => null, { Item: () => null }),
  Slider: () => null,
}));
let mockFocus: (() => void) | undefined;
jest.mock("expo-router", () => {
  const { View, Pressable, Text } = jest.requireActual("react-native");
  const { useEffect } = jest.requireActual("react");
  // Runs the effect while focused, as the real hook does, and keeps it so a test can bring the screen back into focus.
  const useFocusEffect = (effect: () => void) => {
    useEffect(() => {
      mockFocus = effect;
      effect();
    }, [effect]);
  };
  return {
    useFocusEffect,
    useRouter: () => ({ push: mockPush, navigate: mockPush }),
    Stack: {
      Toolbar: Object.assign(View, {
        Button: ({
          children,
          hidden,
          disabled,
          onPress,
        }: {
          children: ReactNode;
          hidden: boolean;
          disabled: boolean;
          onPress: () => void;
        }) =>
          hidden ? null : (
            <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}>
              <Text>{children}</Text>
            </Pressable>
          ),
      }),
    },
  };
});

const published: OwnerWall = {
  scope: "scope-a",
  profileId: "profile-a" as never,
  revision: 3,
  color: "#CDD0CA",
  items: [
    {
      itemId: "item-a" as never,
      placementId: "save-a",
      saveLocalId: "save-a",
      noteVisible: false,
      noteRevision: 0,
      noteEligible: true,
      layout: { x: 0.1, y: 0.2, width: 0.4, frame: "gilt", layer: 0 },
      artwork: {
        title: "The Milkmaid",
        artist: "Johannes Vermeer",
        media: { kind: "placeholder", width: 1, height: 1 },
      },
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockToken = "token";
  switchOwner("account:a", "scope-a");
  mockTransport.getMine.mockResolvedValue(published);
  mockTransport.setLayout.mockImplementation(async (input: Parameters<WallTransport["setLayout"]>[0]) => ({
    ...published,
    ...input,
    revision: input.revision + 1,
    items: input.items.map((item) => ({
      ...published.items[0],
      ...item,
      artwork:
        item.saveLocalId === "save-b"
          ? {
              ...published.items[0].artwork,
              title: "Sunflowers",
              artist: "Vincent van Gogh",
            }
          : published.items[0].artwork,
    })),
  }));
});

async function chooseWallColor(name: string) {
  await fireEvent.press(screen.getByRole("button", { name: "Wallpaper" }));
  await fireEvent.press(screen.getByRole("button", { name }));
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
}

async function addSunflowers() {
  await fireEvent.press(screen.getByRole("button", { name: "Add art" }));
  await fireEvent.press(await screen.findByRole("checkbox", { name: "Sunflowers" }));
  await fireEvent.press(screen.getByRole("button", { name: "Add 1 artwork to wall" }));
}

const libraryWorks = [
  {
    owner: "account:a",
    localId: "save-b",
    title: "Sunflowers",
    artist: "Vincent van Gogh",
    savedAt: 2,
    deletedAt: null,
    syncedBy: "device-a",
    cropPath: null,
  },
] as SavedWork[];

async function openWall() {
  const view = await render(<CollectionWall works={libraryWorks} onEditingChange={jest.fn()} />);
  await fireEvent(screen.getByLabelText("Collection wall"), "layout", {
    nativeEvent: { layout: { width: 393, height: 440, y: 60 } },
  });
  await screen.findByRole("button", { name: "The Milkmaid" });
  return view;
}

it("gives signed-out owners a private wall on this iPhone without contacting the server", async () => {
  mockToken = null;
  switchOwner("device:private-wall", "guest-scope");
  await insertSavedWork(
    { localId: "guest-save", savedAt: 1, title: "Water Lilies", artist: "Claude Monet" },
    "device:private-wall",
  );
  await render(<CollectionWall works={[(await getSavedWork("guest-save"))!]} />);
  const footnote = await screen.findByText("Your wall stays private on this iPhone until you sign in.");
  expect(footnote).toBeOnTheScreen();
  // Native tab bars and their accessories contribute insets; the final action must scroll above them.
  expect(screen.root?.queryAll((node) => node.type === "RCTScrollView")[0].props.contentInsetAdjustmentBehavior).toBe(
    "automatic",
  );
  expect(footnote.parent?.parent).toHaveStyle({ flexGrow: 1 });
  await fireEvent.press(screen.getByRole("button", { name: "Choose artworks" }));
  await fireEvent.press(await screen.findByRole("checkbox", { name: "Water Lilies" }));
  await fireEvent.press(screen.getByRole("button", { name: "Add 1 artwork to wall" }));
  await fireEvent(await screen.findByLabelText("Collection wall"), "layout", {
    nativeEvent: { layout: { width: 393, height: 440, y: 60 } },
  });
  expect(await screen.findByRole("button", { name: "Water Lilies" })).toBeOnTheScreen();
  expect(screen.queryByText(/Changes saved|Private wall/)).toBeNull();
  expect(mockTransport.getMine).not.toHaveBeenCalled();
  expect(mockTransport.setLayout).not.toHaveBeenCalled();
});

it("saves removals and additions immediately and Done only exits the editor", async () => {
  await openWall();
  await fireEvent.press(screen.getByRole("button", { name: "Edit wall" }));
  await fireEvent.press(screen.getByRole("button", { name: "The Milkmaid" }));
  await fireEvent.press(screen.getByRole("button", { name: "Remove artwork from wall" }));
  expect(screen.queryByRole("button", { name: "The Milkmaid" })).toBeNull();
  await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeEnabled());
  expect(mockTransport.setLayout).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ revision: 3, items: [] }),
    expect.anything(),
  );
  await addSunflowers();
  expect(screen.getByRole("button", { name: "Sunflowers" })).toBeOnTheScreen();
  await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeEnabled());
  expect(mockTransport.setLayout).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      revision: 4,
      items: [expect.objectContaining({ saveLocalId: "save-b" })],
    }),
    expect.anything(),
  );
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  expect(screen.getByRole("button", { name: "Edit wall" })).toBeOnTheScreen();
  expect(mockTransport.setLayout).toHaveBeenCalledTimes(2);
});

it("previews wallpaper on the canvas and saves one change only when Done is pressed", async () => {
  await openWall();
  await fireEvent.press(screen.getByRole("button", { name: "Edit wall" }));
  await fireEvent.press(screen.getByRole("button", { name: "Wallpaper" }));
  expect(screen.getByRole("button", { name: "Sage" })).toBeSelected();
  expect(screen.getByRole("button", { name: "Plain" })).toBeSelected();
  await fireEvent.press(screen.getByRole("button", { name: "Stripe" }));
  await fireEvent.press(screen.getByRole("button", { name: "Burgundy" }));
  expect(screen.getByRole("button", { name: "Stripe" })).toBeSelected();
  expect(screen.getByRole("button", { name: "Burgundy" })).toBeSelected();
  expect(screen.getByRole("button", { name: "Sage" })).not.toBeSelected();
  expect(mockTransport.setLayout).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("button", { name: "Stripe" })).toBeNull();
  await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeEnabled());
  expect(mockTransport.setLayout).toHaveBeenCalledTimes(1);
  expect(mockTransport.setLayout).toHaveBeenCalledWith(
    expect.objectContaining({ revision: 3, color: "#6C2F2B", pattern: "stripe" }),
    expect.anything(),
  );

  await fireEvent.press(screen.getByRole("button", { name: "Wallpaper" }));
  expect(screen.getByRole("button", { name: "Stripe" })).toBeSelected();
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  expect(mockTransport.setLayout).toHaveBeenCalledTimes(1);
});

it("hides pending deletions from the wall immediately and restores them on Undo", async () => {
  const view = await openWall();
  await view.rerender(<CollectionWall works={libraryWorks} hiddenIds={["save-a"]} />);
  expect(screen.queryByRole("button", { name: "The Milkmaid" })).toBeNull();
  await view.rerender(<CollectionWall works={[]} hiddenIds={[]} />);
  expect(screen.getByRole("button", { name: "The Milkmaid" })).toBeOnTheScreen();
  expect(mockTransport.setLayout).not.toHaveBeenCalled();
});

it("keeps the wall mounted and the artwork hidden when its Undo window expires", async () => {
  const saveLocalId = "wall-removal-expiry";
  mockTransport.getMine.mockResolvedValue({
    ...published,
    items: published.items.map((item) => ({ ...item, saveLocalId })),
  });
  function RemovalAwareWall() {
    return <CollectionWall works={[]} hiddenIds={useRemovedWorkIds("account:a")} />;
  }
  await render(<RemovalAwareWall />);
  await fireEvent(screen.getByLabelText("Collection wall"), "layout", {
    nativeEvent: { layout: { width: 393, height: 440, y: 60 } },
  });
  expect(await screen.findByRole("button", { name: "The Milkmaid" })).toBeOnTheScreen();
  const canvas = screen.getByLabelText("Collection wall");
  jest.useFakeTimers();
  try {
    await act(() =>
      scheduleRemoval({
        owner: "account:a",
        localId: saveLocalId,
        title: "The Milkmaid",
      }),
    );
    expect(screen.queryByRole("button", { name: "The Milkmaid" })).toBeNull();
    await act(() => jest.advanceTimersByTime(6000));
    expect(screen.queryByRole("button", { name: "The Milkmaid" })).toBeNull();
    expect(screen.getByLabelText("Collection wall")).toBe(canvas);
    expect(screen.queryByRole("progressbar", { name: "Opening your wall…" })).toBeNull();
    expect(mockTransport.getMine).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

it("does not republish deleted artworks from an older wall response", async () => {
  const view = await openWall();
  await view.rerender(<CollectionWall works={libraryWorks} hiddenIds={["save-a"]} />);
  await fireEvent.press(screen.getByRole("button", { name: "Edit wall" }));
  await chooseWallColor("Burgundy");
  await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeEnabled());
  expect(mockTransport.setLayout).toHaveBeenCalledWith(expect.objectContaining({ items: [] }), expect.anything());
});

it("normalizes placement layers while saving with an artwork hidden for deletion", async () => {
  const view = await openWall();
  await view.rerender(<CollectionWall works={libraryWorks} hiddenIds={["save-a"]} />);
  await fireEvent.press(screen.getByRole("button", { name: "Edit wall" }));
  await addSunflowers();
  await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeEnabled());
  const [input] = mockTransport.setLayout.mock.calls[0] as Parameters<WallTransport["setLayout"]>;
  expect(input.items.map((item) => [item.saveLocalId, item.layout.layer])).toEqual([["save-b", 0]]);
});

it("reflects collection updates when opening the library again", async () => {
  const view = await openWall();
  await fireEvent.press(screen.getByRole("button", { name: "Edit wall" }));
  await fireEvent.press(screen.getByRole("button", { name: "Add art" }));
  await screen.findByRole("checkbox", { name: "Sunflowers" });
  await fireEvent.press(screen.getByRole("button", { name: "Wall" }));
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  await view.rerender(<CollectionWall works={[{ ...libraryWorks[0], localId: "save-c", title: "Irises" }]} />);
  await fireEvent.press(screen.getByRole("button", { name: "Edit wall" }));
  await fireEvent.press(screen.getByRole("button", { name: "Add art" }));
  expect(await screen.findByRole("checkbox", { name: "Irises" })).toBeOnTheScreen();
  expect(screen.queryByRole("checkbox", { name: "Sunflowers" })).toBeNull();
});

it("saves each color, frame, and placement edit using the latest acknowledged revision", async () => {
  await openWall();
  await fireEvent.press(screen.getByRole("button", { name: "Edit wall" }));
  await chooseWallColor("Burgundy");
  await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeEnabled());
  await fireEvent.press(screen.getByRole("button", { name: "The Milkmaid" }));
  await fireEvent.press(screen.getByRole("button", { name: "Frame" }));
  await fireEvent.press(screen.getByRole("button", { name: "Baroque" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Baroque" })).toBeEnabled());
  await fireEvent.press(screen.getAllByRole("button", { name: "Done" }).at(-1)!);
  await fireEvent(screen.getByRole("button", { name: "The Milkmaid" }), "accessibilityAction", {
    nativeEvent: { actionName: "moveRight" },
  });
  await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeEnabled());
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  await screen.findByRole("button", { name: "Edit wall" });
  expect(mockTransport.setLayout.mock.calls.map(([input]) => input.revision)).toEqual([3, 4, 5]);
  expect(mockTransport.setLayout).toHaveBeenLastCalledWith(
    {
      scope: "scope-a",
      revision: 5,
      color: "#6C2F2B",
      items: [
        {
          placementId: "save-a",
          saveLocalId: "save-a",
          layout: { ...published.items[0].layout, x: 0.125, frame: "baroque" },
        },
      ],
    },
    expect.anything(),
  );
  expect(mockTransport.setNoteVisibility).not.toHaveBeenCalled();
});

it("retains a failed edit until an explicit retry saves it", async () => {
  await openWall();
  mockTransport.setLayout.mockRejectedValueOnce(new Error("Network request failed"));
  await fireEvent.press(screen.getByRole("button", { name: "Edit wall" }));
  await chooseWallColor("Burgundy");
  expect(await screen.findByRole("alert")).toHaveTextContent(/Your wall change was not saved/);
  expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Add art" })).toBeDisabled();
  expect(mockTransport.setLayout).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "Retry saving" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeEnabled());
  expect(mockTransport.setLayout).toHaveBeenCalledTimes(2);
  expect(mockTransport.setLayout.mock.calls[1][0]).toEqual(mockTransport.setLayout.mock.calls[0][0]);
  expect(screen.queryByRole("alert")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  expect(await screen.findByRole("button", { name: "Edit wall" })).toBeOnTheScreen();
});

it("discards a failed change without publishing and restores the saved wall", async () => {
  await openWall();
  mockTransport.setLayout.mockRejectedValueOnce(new Error("Network request failed"));
  await fireEvent.press(screen.getByRole("button", { name: "Edit wall" }));
  await chooseWallColor("Burgundy");
  await screen.findByRole("alert");
  await fireEvent.press(screen.getByRole("button", { name: "Discard unsaved change" }));
  expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(mockTransport.setLayout).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "Wallpaper" }));
  expect(screen.getByRole("button", { name: "Sage" })).toBeSelected();
  await fireEvent.press(screen.getByRole("button", { name: "Burgundy" }));
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(mockTransport.setLayout).toHaveBeenCalledTimes(2));
});

it("retains a conflicted edit and waits for explicit retry against the refreshed revision", async () => {
  await openWall();
  mockTransport.setLayout.mockRejectedValueOnce(new ConvexError({ code: "conflict" }));
  mockTransport.getMine.mockResolvedValue({ ...published, revision: 7 });
  await fireEvent.press(screen.getByRole("button", { name: "Edit wall" }));
  await chooseWallColor("Burgundy");
  expect(await screen.findByRole("alert")).toHaveTextContent(/changed on another device/);
  expect(mockTransport.setLayout).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "Retry saving" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeEnabled());
  expect(mockTransport.setLayout).toHaveBeenLastCalledWith(
    expect.objectContaining({ revision: 7, color: "#6C2F2B" }),
    expect.anything(),
  );
});

it("keeps editor controls visible and locked during a save", async () => {
  await openWall();
  let resolveSave!: (wall: OwnerWall) => void;
  mockTransport.setLayout.mockImplementationOnce(
    () =>
      new Promise<OwnerWall>((resolve) => {
        resolveSave = resolve;
      }),
  );
  await fireEvent.press(screen.getByRole("button", { name: "Edit wall" }));
  await fireEvent.press(screen.getByRole("button", { name: "The Milkmaid" }));
  await fireEvent.press(screen.getByRole("button", { name: "Frame" }));
  await fireEvent.press(screen.getByRole("button", { name: "Baroque" }));
  await waitFor(() => expect(mockTransport.setLayout).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("header", { name: "Edit frame" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Baroque" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Done", disabled: true })).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: "Baroque" }));
  expect(mockTransport.setLayout).toHaveBeenCalledTimes(1);
  await act(async () =>
    resolveSave({
      ...published,
      revision: 4,
      items: published.items.map((item) => ({
        ...item,
        layout: { ...item.layout, frame: "baroque" },
      })),
    }),
  );
  expect(screen.getByRole("button", { name: "Baroque" })).toBeEnabled();
});

it("cancels an in-flight save when its owner changes without retaining a stale wall or error", async () => {
  await openWall();
  let resolveSave!: (wall: OwnerWall) => void;
  mockTransport.setLayout.mockImplementationOnce(
    () =>
      new Promise<OwnerWall>((resolve) => {
        resolveSave = resolve;
      }),
  );
  await fireEvent.press(screen.getByRole("button", { name: "Edit wall" }));
  await chooseWallColor("Burgundy");
  await waitFor(() => expect(mockTransport.setLayout).toHaveBeenCalledTimes(1));
  const context = mockTransport.setLayout.mock.calls[0][1];
  await act(() => {
    mockToken = null;
    switchOwner("device:guest", "guest-scope");
  });
  expect(context.signal.aborted).toBe(true);
  await act(async () => resolveSave({ ...published, revision: 4, color: "#6C2F2B" }));
  expect(screen.queryByRole("button", { name: "The Milkmaid" })).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry saving" })).toBeNull();
  expect(await screen.findByRole("button", { name: "Scan artwork" })).toBeOnTheScreen();
});

it("persists resizing directly from the wall without opening a sheet", async () => {
  await openWall();
  await fireEvent.press(screen.getByRole("button", { name: "Edit wall" }));
  await fireEvent.press(screen.getByRole("button", { name: "The Milkmaid" }));
  await fireEvent(screen.getByRole("button", { name: "The Milkmaid" }), "accessibilityAction", {
    nativeEvent: { actionName: "increment" },
  });
  await waitFor(() => expect(mockTransport.setLayout).toHaveBeenCalledTimes(1));
  expect(mockTransport.setLayout).toHaveBeenCalledWith(
    expect.objectContaining({
      items: [
        expect.objectContaining({ layout: expect.objectContaining({ width: published.items[0].layout.width + 0.04 }) }),
      ],
    }),
    expect.anything(),
  );
  expect(screen.queryByRole("header", { name: "Edit frame" })).toBeNull();
});

it("shows the empty wall instead of a spinner while the account scope is still missing", async () => {
  switchOwner("account:a");
  await render(<CollectionWall works={libraryWorks} onEditingChange={jest.fn()} />);
  expect(screen.queryByText("Opening your wall…")).toBeNull();
  expect(screen.getByRole("button", { name: "Load wall" })).toBeOnTheScreen();
  expect(mockTransport.getMine).not.toHaveBeenCalled();
});

it("treats a missing profile on refresh as a state rather than an error", async () => {
  mockTransport.getMine.mockRejectedValue(new ConvexError({ code: "profile_required" }));
  const { result } = await renderHook(() => useCollectionWall([]));
  await waitFor(() => expect(result.current.profileRequired).toBe(true));
  await act(() => result.current.refresh());
  expect(result.current.profileRequired).toBe(true);
  expect(result.current.error).toBeUndefined();
  expect(result.current.loading).toBe(false);
});

it("re-reads the wall each time the screen regains focus after the first load", async () => {
  await openWall();
  expect(mockTransport.getMine).toHaveBeenCalledTimes(1);
  mockTransport.getMine.mockResolvedValue({ ...published, items: [] });
  await act(async () => {
    mockFocus?.();
  });
  await waitFor(() => expect(screen.queryByRole("button", { name: "The Milkmaid" })).toBeNull());
  expect(mockTransport.getMine).toHaveBeenCalledTimes(2);
});

it("re-reads a signed-out wall on focus after another screen changed it", async () => {
  mockToken = null;
  switchOwner("device:refocused-wall", "guest-scope");
  const work = {
    owner: "device:refocused-wall",
    localId: "refocus-save",
    savedAt: 1,
    title: "Water Lilies",
    artist: "Claude Monet",
  };
  await insertSavedWork(work, "device:refocused-wall");
  await render(<CollectionWall works={[work as SavedWork]} />);
  expect(await screen.findByText("Your wall stays private on this iPhone until you sign in.")).toBeOnTheScreen();
  // An artwork's detail screen hangs it through its own repository.
  const detail = createLocalWallRepository();
  detail.connect();
  await detail.refresh();
  detail.setLayoutDraft({
    color: "#6C2F2B",
    items: [
      {
        placementId: "refocus-placement",
        saveLocalId: work.localId,
        layout: { x: 0, y: 0, width: 0.5, layer: 0, frame: "black" },
      },
    ],
  });
  await detail.publishLayout();
  detail.dispose();
  await act(async () => {
    mockFocus?.();
  });
  await fireEvent(await screen.findByLabelText("Collection wall"), "layout", {
    nativeEvent: { layout: { width: 393, height: 440, y: 60 } },
  });
  expect(await screen.findByRole("button", { name: "Water Lilies" })).toBeOnTheScreen();
});

it("publishes the wall arranged before sign-in once the account's wall reads empty", async () => {
  await insertSavedWork(
    { localId: "claimed-save", savedAt: 1, title: "Water Lilies", artist: "Claude Monet" },
    "account:a",
  );
  const layout = { x: 0, y: 0, width: 0.5, layer: 0, frame: "black" as const };
  await setSetting(
    "wall:account:a",
    JSON.stringify({ color: "#6C2F2B", items: [{ placementId: "claimed", saveLocalId: "claimed-save", layout }] }),
  );
  mockTransport.getMine.mockResolvedValue({ ...published, items: [] });
  await renderHook(() => useCollectionWall([]));
  await waitFor(() => expect(mockTransport.setLayout).toHaveBeenCalledTimes(1));
  expect(mockTransport.setLayout.mock.calls[0][0]).toMatchObject({
    color: "#6C2F2B",
    items: [{ placementId: "claimed", saveLocalId: "claimed-save", layout }],
  });
  await waitFor(async () => expect(await getSetting("wall:account:a")).toBeUndefined());
});

it("does not reload the wall when only the auth token rotates", async () => {
  const { result, rerender } = await renderHook(() => useCollectionWall([]));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(mockTransport.getMine).toHaveBeenCalledTimes(1);
  mockToken = "rotated-token";
  await rerender(undefined);
  expect(result.current.loading).toBe(false);
  expect(mockTransport.getMine).toHaveBeenCalledTimes(1);
});

it("shows a blank wall to an account without a profile until it has art to hang", async () => {
  mockTransport.getMine.mockRejectedValue(new ConvexError({ code: "profile_required" }));
  await render(<CollectionWall works={[]} onEditingChange={jest.fn()} />);
  await fireEvent.press(await screen.findByRole("button", { name: "Scan artwork" }));
  expect(mockPush).toHaveBeenLastCalledWith("/scan");
  expect(screen.queryByRole("button", { name: "Create profile" })).toBeNull();
});

it("asks an account without a profile to create one before choosing artworks", async () => {
  mockTransport.getMine.mockRejectedValue(new ConvexError({ code: "profile_required" }));
  await render(<CollectionWall works={libraryWorks} />);
  await fireEvent.press(await screen.findByRole("button", { name: "Choose artworks" }));
  expect(screen.getByRole("header", { name: "Your public wall" })).toBeOnTheScreen();
});

it("clears a rendered wall immediately when its owner changes", async () => {
  await openWall();
  await act(() => {
    mockToken = null;
    switchOwner("device:guest", "guest-scope");
  });
  expect(screen.queryByRole("button", { name: "The Milkmaid" })).toBeNull();
  expect(await screen.findByRole("button", { name: "Scan artwork" })).toBeOnTheScreen();
});

it.each([false, true])("loads local draft artwork proportions, tolerating a missing photo (%s)", async (missing) => {
  const getSize = jest.spyOn(Image, "getSize").mockImplementation(async () => {
    if (missing) throw new Error("File missing");
    return { width: 600, height: 900 };
  });
  try {
    const works = [
      {
        owner: "account:a",
        localId: "save-b",
        cropPath: "crops/sunflowers.jpg",
        title: "Sunflowers",
        artist: "Vincent van Gogh",
      },
    ] as SavedWork[];
    const { result } = await renderHook(() => useCollectionWall(works));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() =>
      result.current.repository.setLayoutDraft({
        color: "#CDD0CA",
        items: [
          {
            placementId: "save-b",
            saveLocalId: "save-b",
            layout: published.items[0].layout,
          },
        ],
      }),
    );
    expect(result.current.pieces[0].artwork.title).toBe("Sunflowers");
    await waitFor(() => expect(wallAspect(result.current.pieces[0])).toBeCloseTo(missing ? 1 : 600 / 900));
    expect(mockTransport.setLayout).not.toHaveBeenCalled();
  } finally {
    getSize.mockRestore();
  }
});

it("opens the selected wall photo in the private artwork album", async () => {
  mockTransport.getMine.mockResolvedValue({
    ...published,
    items: [{ ...published.items[0], photoLocalId: "detail-photo" }],
  });
  await render(<CollectionWall works={[{ localId: "save-a" } as SavedWork]} />);
  await fireEvent(screen.getByLabelText("Collection wall"), "layout", {
    nativeEvent: { layout: { width: 393, y: 0 } },
  });
  await fireEvent.press(await screen.findByRole("button", { name: "The Milkmaid" }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/saved/[savedId]",
    params: { savedId: "save-a", photoId: "detail-photo" },
  });
});

it("scrolls a newly hung artwork into view", async () => {
  const scrollTo = jest.spyOn(ScrollView.prototype, "scrollTo");
  try {
    await openWall();
    await fireEvent.press(screen.getByRole("button", { name: "Edit wall" }));
    await addSunflowers();
    await waitFor(() => {
      const call = scrollTo.mock.calls.find(
        ([options]) => typeof options === "object" && options && "y" in options && (options.y ?? 0) > 0,
      );
      expect((call?.[0] as { y: number } | undefined)?.y).toBeGreaterThan(0);
    });
    expect(screen.getByRole("button", { name: "Sunflowers" })).toBeOnTheScreen();
  } finally {
    scrollTo.mockRestore();
  }
});

it("keeps artwork tools contextual and lets the picker add artwork without reselecting hung pieces", async () => {
  await openWall();
  await fireEvent.press(screen.getByRole("button", { name: "Edit wall" }));
  expect(screen.queryByRole("button", { name: "Frame" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "The Milkmaid" }));
  expect(screen.getByRole("button", { name: "Frame" })).toBeEnabled();
  await fireEvent.press(screen.getByRole("button", { name: "Deselect artwork" }));
  await fireEvent.press(screen.getByRole("button", { name: "Add art" }));
  await fireEvent.press(screen.getByRole("checkbox", { name: "Sunflowers" }));
  expect(mockTransport.setLayout).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Add 1 artwork to wall" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeEnabled());
  expect(screen.getByRole("button", { name: "Sunflowers" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Deselect artwork" }));
  expect(screen.queryByRole("button", { name: "Frame" })).toBeNull();
  expect(mockTransport.setLayout).toHaveBeenCalledTimes(1);
});

it("saves an empty wall’s wallpaper with Done and has no separate apply or cancel controls", async () => {
  mockTransport.getMine.mockResolvedValue({ ...published, items: [] });
  await render(<CollectionWall works={[]} />);
  await fireEvent.press(await screen.findByRole("button", { name: "Edit wall" }));
  await fireEvent.press(screen.getByRole("button", { name: "Wallpaper" }));
  await fireEvent.press(screen.getByRole("button", { name: "Burgundy" }));
  await fireEvent.press(screen.getByRole("button", { name: "Trellis" }));
  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
  expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Wallpaper" })).toBeEnabled());
  expect(mockTransport.setLayout).toHaveBeenCalledWith(
    expect.objectContaining({ color: "#6C2F2B", pattern: "trellis", items: [] }),
    expect.anything(),
  );
  await fireEvent.press(screen.getByRole("button", { name: "Wallpaper" }));
  expect(screen.getByRole("button", { name: "Burgundy" })).toBeSelected();
  expect(screen.getByRole("button", { name: "Trellis" })).toBeSelected();
});

it("shows a blank wall and opens Scan when there is no saved art", async () => {
  mockTransport.getMine.mockResolvedValue({ ...published, items: [] });
  await render(<CollectionWall works={[]} />);
  await fireEvent.press(await screen.findByRole("button", { name: "Scan artwork" }));
  expect(mockPush).toHaveBeenLastCalledWith("/scan");
  expect(screen.getByText("No artworks on your wall yet.")).toBeOnTheScreen();
  expect(screen.queryByText("No saved artworks yet.")).toBeNull();
  let settle: (wall: OwnerWall) => void = () => {};
  mockTransport.getMine.mockImplementation(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  );
  await act(async () => {
    mockFocus?.();
  });
  expect(screen.getByLabelText("Refreshing wall")).toBeOnTheScreen();
  await act(async () => {
    settle({ ...published, items: [] });
  });
  expect(screen.queryByLabelText("Refreshing wall")).toBeNull();
});

it("opens the editor from an empty wall when saved art is available", async () => {
  mockTransport.getMine.mockResolvedValue({ ...published, items: [] });
  await render(<CollectionWall works={libraryWorks} />);
  await fireEvent.press(await screen.findByRole("button", { name: "Choose artworks" }));
  await fireEvent.press(await screen.findByRole("checkbox", { name: "Sunflowers" }));
  await fireEvent.press(screen.getByRole("button", { name: "Add 1 artwork to wall" }));
  expect(screen.getByRole("header", { name: "Edit wall" })).toBeOnTheScreen();
  expect(mockTransport.setLayout).toHaveBeenCalledWith(
    expect.objectContaining({
      items: [expect.objectContaining({ saveLocalId: "save-b" })],
    }),
    expect.anything(),
  );
});

it("uses the crop and its proportions on the wall while preserving the full photo to open", async () => {
  const owner = "device:cropped-wall";
  switchOwner(owner, "crop-scope");
  mockToken = null;
  const work = {
    owner,
    localId: "cropped-work",
    title: "Water Lilies",
    artist: "Monet",
    savedAt: 1,
    photoPath: "full-capture.jpg",
    cropPath: "painting-crop.jpg",
    cropPhotoLocalId: "cropped-work",
  } as SavedWork;
  await insertSavedWork(work, owner);
  addArtworkPhoto(
    { savedLocalId: work.localId, localId: "chosen-detail", path: "detail.jpg", kind: "detail", capturedAt: 2 },
    owner,
  );
  const getSize = jest.spyOn(Image, "getSize").mockImplementation(async () => ({ width: 600, height: 400 }));
  try {
    const { result } = await renderHook(() => useCollectionWall([work]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() =>
      result.current.repository.setLayoutDraft({
        color: "#FCFCF9",
        items: [
          {
            placementId: "crop-placement",
            saveLocalId: work.localId,
            photoLocalId: work.localId,
            layout: published.items[0].layout,
          },
        ],
      }),
    );
    await waitFor(() => expect(result.current.pieces[0].cropAspectRatio).toBe(1.5));
    expect(result.current.pieces[0]).toMatchObject({ cropPath: "painting-crop.jpg", photoLocalId: work.localId });
    expect(getSize).toHaveBeenCalledWith("file:///documents/painting-crop.jpg");
    await act(() =>
      result.current.repository.setLayoutDraft({
        color: "#FCFCF9",
        items: [
          {
            placementId: "crop-placement",
            saveLocalId: work.localId,
            photoLocalId: "chosen-detail",
            layout: published.items[0].layout,
          },
        ],
      }),
    );
    await waitFor(() => expect(result.current.pieces[0].cropPath).toBe("detail.jpg"));
  } finally {
    getSize.mockRestore();
  }
});

it("keeps the old wall photo full after the crop source changes locally", async () => {
  const owner = "account:review-local";
  switchOwner(owner, "scope-a");
  await insertSavedWork(
    {
      localId: "review-work",
      title: "Painting",
      artist: "Artist",
      savedAt: 1,
      photoPath: "a.jpg",
      cropPath: "crop-a.jpg",
    },
    owner,
  );
  addArtworkPhoto(
    { savedLocalId: "review-work", localId: "photo-b", kind: "detail", path: "b.jpg", capturedAt: 2 },
    owner,
  );
  const item = {
    ...published.items[0],
    saveLocalId: "review-work",
    photoLocalId: "review-work",
    artwork: {
      ...published.items[0].artwork,
      media: {
        kind: "photo",
        width: 100,
        height: 100,
        reference: { kind: "wallItem", itemId: "item-a", photoLocalId: "review-work", variant: "crop" },
      },
    },
  };
  mockTransport.getMine.mockResolvedValue({ ...published, items: [item] });
  const getSize = jest.spyOn(Image, "getSize").mockImplementation(async () => ({ width: 100, height: 100 }));
  try {
    let work = (await getSavedWork("review-work", owner))!;
    const view = await renderHook(() => useCollectionWall([work]));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current.pieces[0].cropPath).toBe("crop-a.jpg");
    replaceSavedCrop("review-work", "crop-b.jpg", null, "b.jpg", owner);
    work = (await getSavedWork("review-work", owner))!;
    await view.rerender(undefined);
    expect(view.result.current.pieces[0].cropPath).toBe("a.jpg");
  } finally {
    getSize.mockRestore();
  }
});

it("keeps photo A full after photo B is cropped on another device", async () => {
  const owner = "account:review-remote";
  switchOwner(owner, "scope-a");
  await insertSavedWork(
    {
      localId: "remote-work",
      title: "Painting",
      artist: "Artist",
      savedAt: 1,
      photoPath: "a.jpg",
      cropPath: "crop-a.jpg",
      cropStorageId: "old-storage",
      photoUpdatedAt: 1,
    },
    owner,
  );
  addArtworkPhoto(
    { savedLocalId: "remote-work", localId: "remote-b", kind: "detail", path: "b.jpg", capturedAt: 2 },
    owner,
  );
  await upsertFromRemote(
    [
      {
        localId: "remote-work",
        snapshot: { title: "Painting", artist: "Artist" },
        savedAt: 1,
        updatedAt: 2,
        updatedBy: "another-device",
        cropStorageId: "new-storage",
        cropPhotoLocalId: "remote-b",
        photoUpdatedAt: 2,
      } as never,
    ],
    owner,
  );
  await updatePhotoTransfer("remote-work", { cropPath: "crop-b.jpg" }, owner);
  mockTransport.getMine.mockResolvedValue({
    ...published,
    items: [
      {
        ...published.items[0],
        saveLocalId: "remote-work",
        photoLocalId: "remote-work",
        artwork: {
          ...published.items[0].artwork,
          media: {
            kind: "photo",
            width: 100,
            height: 100,
            reference: { kind: "wallItem", itemId: "item-a", photoLocalId: "remote-work" },
          },
        },
      },
    ],
  });
  const getSize = jest.spyOn(Image, "getSize").mockImplementation(async () => ({ width: 100, height: 100 }));
  try {
    const work = (await getSavedWork("remote-work", owner))!;
    const view = await renderHook(() => useCollectionWall([work]));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current.pieces[0].cropPath).toBe("a.jpg");
  } finally {
    getSize.mockRestore();
  }
});

it("publishes a reviewed multi-artwork selection in one wall update", async () => {
  const works = [...libraryWorks, { ...libraryWorks[0], localId: "save-c", title: "Irises", savedAt: 1 }];
  await render(<CollectionWall works={works} />);
  await fireEvent.press(await screen.findByRole("button", { name: "Edit wall" }));
  await fireEvent.press(screen.getByRole("button", { name: "Add art" }));
  await fireEvent.press(screen.getByRole("checkbox", { name: "Sunflowers" }));
  await fireEvent.changeText(screen.getByLabelText("Search artworks"), "Irises");
  await fireEvent.press(screen.getByRole("checkbox", { name: "Irises" }));
  await fireEvent.press(screen.getByRole("button", { name: "Review selected artworks" }));
  await fireEvent.press(screen.getByRole("button", { name: "Add 2 artworks to wall" }));
  await waitFor(() => expect(mockTransport.setLayout).toHaveBeenCalledTimes(1));
  const [input] = mockTransport.setLayout.mock.calls[0] as Parameters<WallTransport["setLayout"]>;
  expect(input.items.map((item) => item.saveLocalId)).toEqual(["save-a", "save-b", "save-c"]);
  expect(screen.queryByRole("header", { name: "Selected artworks" })).toBeNull();
});

it("releases a cancelled artwork addition and lets the same owner retry in a new session", async () => {
  let resolveSize!: (size: { width: number; height: number }) => void;
  const measurement = new Promise<{ width: number; height: number }>((resolve) => {
    resolveSize = resolve;
  });
  const getSize = jest.spyOn(Image, "getSize").mockImplementation(() => measurement);
  try {
    await render(<CollectionWall works={[{ ...libraryWorks[0], cropPath: "sunflowers.jpg" }]} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Edit wall" }));
    await addSunflowers();
    expect(getSize).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Wall" })).toBeDisabled();

    mockTransport.getMine.mockResolvedValue({ ...published, scope: "scope-b" });
    await act(() => switchOwner("account:a", "scope-b"));
    await act(async () => {
      resolveSize({ width: 600, height: 800 });
      await measurement;
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Wall" })).toBeEnabled());
    expect(mockTransport.setLayout).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Add 1 artwork to wall" }));
    await waitFor(() => expect(mockTransport.setLayout).toHaveBeenCalledTimes(1));
    expect(mockTransport.setLayout).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "scope-b",
        items: expect.arrayContaining([expect.objectContaining({ saveLocalId: "save-b" })]),
      }),
      expect.anything(),
    );
  } finally {
    getSize.mockRestore();
  }
});

it("keeps Done outside the scrolling wall when the collection header is hidden for editing", async () => {
  await render(<CollectionWall works={libraryWorks} header={<Text>Collection header</Text>} />);
  await fireEvent.press(await screen.findByRole("button", { name: "Edit wall" }));
  const canvasScroll = screen.root!.queryAll((node) => node.type === "RCTScrollView")[0];
  expect(within(canvasScroll).queryByRole("button", { name: "Done" })).toBeNull();
  expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
  expect(screen.queryByText("Collection header")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  expect(screen.getByText("Collection header")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Edit wall" })).toBeEnabled();
});

it("keeps only Frame and Remove in the selected palette and only frame choices in the frame sheet", async () => {
  await openWall();
  await fireEvent.press(screen.getByRole("button", { name: "Edit wall" }));
  await fireEvent.press(screen.getByRole("button", { name: "The Milkmaid" }));
  expect(screen.getByRole("button", { name: "Remove artwork from wall" })).toBeEnabled();
  for (const name of ["Photo", "Arrange", "Close"]) {
    expect(screen.queryByRole("button", { name })).toBeNull();
  }
  await fireEvent.press(screen.getByRole("button", { name: "Frame" }));
  expect(screen.getByRole("header", { name: "Edit frame" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Oak" })).toBeOnTheScreen();
  for (const name of ["Photo", "Arrange", "Take off wall", "Choose photo"]) {
    expect(screen.queryByRole("button", { name })).toBeNull();
  }
  expect(screen.queryByRole("adjustable", { name: "Artwork size" })).toBeNull();
});
