import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react-native";
import { ConvexError } from "convex/values";
import type { ComponentProps, ReactNode } from "react";
import { Image, ScrollView } from "react-native";
import type { SavedWork } from "@/db/schema";
import { useCollectionWall } from "@/lib/wall/use-collection-wall";
import { wallAspect } from "@/lib/wall/wall-layout";
import type { OwnerWall, WallTransport } from "@/lib/wall/wall-transport";
import { switchOwner } from "@/lib/account/owner-store";
import { CollectionWall } from "./collection-wall";
import { insertSavedWork } from "@/db/repos/saved-works";
import { addArtworkPhoto } from "@/db/repos/artwork-album";
import { scheduleRemoval, useRemovedWorkIds } from "@/lib/collection/pending-removals";

jest.mock("expo-crypto", () => ({
  randomUUID: () => jest.requireActual("node:crypto").randomUUID(),
}));
jest.mock("@/db/client", () => ({ db: jest.requireActual("@/db/test-db").createTestDatabase() }));
jest.mock("@/lib/account/collection-sync", () => ({ flushCollectionMedia: async () => {} }));
const mockPush = jest.fn();
let mockToken: string | null = "token";
const mockTransport = {
  getMine: jest.fn(),
  setLayout: jest.fn(),
  listMine: jest.fn(),
  setNoteVisibility: jest.fn(),
} satisfies WallTransport;
jest.mock("@convex-dev/auth/react", () => ({ useAuthToken: () => mockToken }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));
jest.mock("expo-network", () => ({
  getNetworkStateAsync: async () => ({ isConnected: true, isInternetReachable: true }),
}));
jest.mock("@/lib/wall/wall-transport", () => ({ createWallTransport: () => mockTransport }));
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
      children,
    }: {
      pieces: { localId: string; artwork: { title: string } }[];
      onSelect: (piece: unknown) => void;
      children: ReactNode;
    }) => (
      <View>
        {pieces.map((piece) => (
          <Pressable key={piece.localId} accessibilityRole="button" onPress={() => onSelect(piece)}>
            <Text>{piece.artwork.title}</Text>
          </Pressable>
        ))}
        {children}
      </View>
    ),
  };
});
jest.mock("@expo/ui", () => ({
  ...jest.requireActual("@/__mocks__/@expo/ui"),
  Picker: Object.assign(() => null, { Item: () => null }),
  Slider: () => null,
}));
jest.mock("@expo/ui/swift-ui", () => {
  const { View } = jest.requireActual("react-native");
  return {
    ...jest.requireActual("@/__mocks__/@expo/ui/swift-ui"),
    Slider: ({
      modifiers,
      ...props
    }: ComponentProps<typeof import("@expo/ui/swift-ui").Slider>) => (
      <View
        {...props}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Artwork size"
        accessibilityState={{
          disabled: modifiers?.some(
            (modifier) => modifier.$type === "disabled" && modifier.disabled,
          ),
        }}
      />
    ),
  };
});
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
  mockTransport.listMine.mockResolvedValue({
    page: [{ localId: "save-b", snapshot: { title: "Sunflowers", artist: "Vincent van Gogh" } }],
    cursor: null,
    isDone: true,
  });
  mockTransport.setLayout.mockImplementation(
    async (input: Parameters<WallTransport["setLayout"]>[0]) => ({
      ...published,
      ...input,
      revision: input.revision + 1,
      items: input.items.map((item) => ({
        ...published.items[0],
        ...item,
        artwork:
          item.saveLocalId === "save-b"
            ? { ...published.items[0].artwork, title: "Sunflowers", artist: "Vincent van Gogh" }
            : published.items[0].artwork,
      })),
    }),
  );
});

async function openWall() {
  const view = await render(<CollectionWall works={[]} onEditingChange={jest.fn()} />);
  await fireEvent(screen.getByLabelText("Collection wall"), "layout", {
    nativeEvent: { layout: { width: 393, height: 440, y: 60 } },
  });
  await screen.findByRole("button", { name: "The Milkmaid" });
  return view;
}

it("gives guests a sign-in action without requesting or publishing a wall", async () => {
  mockToken = null;
  switchOwner("device:guest", "guest-scope");
  const onEditingChange = jest.fn();
  await render(<CollectionWall works={[]} onEditingChange={onEditingChange} />);
  await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/sign-in", params: { context: "wall" } });
  await fireEvent.press(screen.getByRole("button", { name: "All artworks" }));
  expect(mockPush).toHaveBeenCalledWith("/all-artworks");
  expect(mockTransport.getMine).not.toHaveBeenCalled();
  expect(mockTransport.setLayout).not.toHaveBeenCalled();
});

it("chooses the photo before adding a second public placement and publishes on confirmation", async () => {
  const imageSize = jest
    .spyOn(Image, "getSize")
    .mockImplementation(async () => ({ width: 640, height: 480 }));
  mockTransport.getMine.mockResolvedValue({
    ...published,
    items: published.items.map((item) => ({ ...item, layout: { ...item.layout, frame: "black" } })),
  });
  await insertSavedWork(
    { localId: "save-a", savedAt: 1, title: "The Milkmaid", artist: "Johannes Vermeer" },
    "account:a",
  );
  addArtworkPhoto(
    { localId: "wall-full", savedLocalId: "save-a", capturedAt: 1, kind: "full", path: "full.jpg" },
    "account:a",
  );
  addArtworkPhoto(
    {
      localId: "wall-detail",
      savedLocalId: "save-a",
      capturedAt: 2,
      kind: "detail",
      path: "detail.jpg",
    },
    "account:a",
  );
  await openWall();
  await fireEvent.press(screen.getByRole("button", { name: "Edit wall" }));
  await fireEvent.press(screen.getByRole("button", { name: "The Milkmaid" }));
  await fireEvent.press(screen.getByRole("button", { name: "Frame & photo" }));
  await fireEvent.press(screen.getByRole("button", { name: "Hang another photo" }));
  expect(
    screen.getByText(/This selected image will be visible on your public wall/),
  ).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Hang selected photo" })).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: "Use detail photo 2 on wall" }));
  expect(mockTransport.setLayout).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Hang selected photo" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeEnabled());
  expect(mockTransport.setLayout).toHaveBeenCalledTimes(1);
  const [input] = mockTransport.setLayout.mock.calls[0] as Parameters<WallTransport["setLayout"]>;
  expect(input.items).toHaveLength(2);
  expect(input.items[1]).toMatchObject({
    saveLocalId: "save-a",
    photoLocalId: "wall-detail",
    layout: { frame: "black" },
  });
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  expect(mockTransport.setLayout).toHaveBeenCalledTimes(1);
  imageSize.mockRestore();
});

it("saves removals and additions immediately and Done only exits the editor", async () => {
  await openWall();
  await fireEvent.press(screen.getByRole("button", { name: "Edit wall" }));
  await fireEvent.press(screen.getByRole("button", { name: "The Milkmaid" }));
  await fireEvent.press(screen.getByRole("button", { name: "Frame & photo" }));
  await fireEvent.press(screen.getByRole("button", { name: "Take off wall" }));
  expect(screen.queryByRole("button", { name: "The Milkmaid" })).toBeNull();
  await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeEnabled());
  expect(mockTransport.setLayout).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ revision: 3, items: [] }),
    expect.anything(),
  );
  await fireEvent.press(await screen.findByRole("button", { name: "Hang Sunflowers" }));
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

it("hides pending deletions from the wall immediately and restores them on Undo", async () => {
  const view = await openWall();
  await view.rerender(<CollectionWall works={[]} hiddenIds={["save-a"]} />);
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
      scheduleRemoval({ owner: "account:a", localId: saveLocalId, title: "The Milkmaid" }),
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
  await view.rerender(<CollectionWall works={[]} hiddenIds={["save-a"]} />);
  await fireEvent.press(screen.getByRole("button", { name: "Edit wall" }));
  await fireEvent.press(screen.getByRole("button", { name: "Burgundy wall" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeEnabled());
  expect(mockTransport.setLayout).toHaveBeenCalledWith(
    expect.objectContaining({ items: [] }),
    expect.anything(),
  );
});

it("normalizes placement layers while saving with an artwork hidden for deletion", async () => {
  const view = await openWall();
  await view.rerender(<CollectionWall works={[]} hiddenIds={["save-a"]} />);
  await fireEvent.press(screen.getByRole("button", { name: "Edit wall" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Hang Sunflowers" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeEnabled());
  const [input] = mockTransport.setLayout.mock.calls[0] as Parameters<WallTransport["setLayout"]>;
  expect(input.items.map((item) => [item.saveLocalId, item.layout.layer])).toEqual([["save-b", 0]]);
});

it("reloads the synced collection each time editing begins", async () => {
  await openWall();
  await fireEvent.press(screen.getByRole("button", { name: "Edit wall" }));
  await screen.findByRole("button", { name: "Hang Sunflowers" });
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  expect(mockTransport.setLayout).not.toHaveBeenCalled();
  mockTransport.listMine.mockResolvedValue({
    page: [{ localId: "save-c", snapshot: { title: "Irises", artist: "Vincent van Gogh" } }],
    cursor: null,
    isDone: true,
  });
  await fireEvent.press(screen.getByRole("button", { name: "Edit wall" }));
  expect(await screen.findByRole("button", { name: "Hang Irises" })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Hang Sunflowers" })).toBeNull();
});

it("saves each color, frame, and placement edit using the latest acknowledged revision", async () => {
  await openWall();
  await fireEvent.press(screen.getByRole("button", { name: "Edit wall" }));
  await fireEvent.press(screen.getByRole("button", { name: "Burgundy wall" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeEnabled());
  await fireEvent.press(screen.getByRole("button", { name: "The Milkmaid" }));
  await fireEvent.press(screen.getByRole("button", { name: "Frame & photo" }));
  await fireEvent.press(screen.getByRole("button", { name: "Baroque" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Right" })).toBeEnabled());
  await fireEvent.press(screen.getByRole("button", { name: "Right" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Right" })).toBeEnabled());
  await fireEvent.press(screen.getAllByRole("button", { name: "Done" }).at(-1)!);
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
  await fireEvent.press(screen.getByRole("button", { name: "Burgundy wall" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/Your wall change was not saved/);
  expect(screen.getByRole("button", { name: "Burgundy wall" })).toBeSelected();
  expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Hang Sunflowers" })).toBeDisabled();
  expect(mockTransport.setLayout).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "Retry saving" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeEnabled());
  expect(mockTransport.setLayout).toHaveBeenCalledTimes(2);
  expect(mockTransport.setLayout.mock.calls[1][0]).toEqual(
    mockTransport.setLayout.mock.calls[0][0],
  );
  expect(screen.queryByRole("alert")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  expect(await screen.findByRole("button", { name: "Edit wall" })).toBeOnTheScreen();
});

it("discards a failed change without publishing and restores the saved wall", async () => {
  await openWall();
  mockTransport.setLayout.mockRejectedValueOnce(new Error("Network request failed"));
  await fireEvent.press(screen.getByRole("button", { name: "Edit wall" }));
  await fireEvent.press(screen.getByRole("button", { name: "Burgundy wall" }));
  await screen.findByRole("alert");
  await fireEvent.press(screen.getByRole("button", { name: "Discard unsaved change" }));
  expect(screen.getByRole("button", { name: "Burgundy wall" })).not.toBeSelected();
  expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(mockTransport.setLayout).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "Burgundy wall" }));
  await waitFor(() => expect(mockTransport.setLayout).toHaveBeenCalledTimes(2));
});

it("retains a conflicted edit and waits for explicit retry against the refreshed revision", async () => {
  await openWall();
  mockTransport.setLayout.mockRejectedValueOnce(new ConvexError({ code: "conflict" }));
  mockTransport.getMine.mockResolvedValue({ ...published, revision: 7 });
  await fireEvent.press(screen.getByRole("button", { name: "Edit wall" }));
  await fireEvent.press(screen.getByRole("button", { name: "Burgundy wall" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/changed on another device/);
  expect(screen.getByRole("button", { name: "Burgundy wall" })).toBeSelected();
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
  await fireEvent.press(screen.getByRole("button", { name: "Frame & photo" }));
  await fireEvent.press(screen.getByRole("button", { name: "Right" }));
  await waitFor(() => expect(mockTransport.setLayout).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("header", { name: "Edit artwork" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Right" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Take off wall" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Done", disabled: true })).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: "Right" }));
  expect(mockTransport.setLayout).toHaveBeenCalledTimes(1);
  await act(async () =>
    resolveSave({
      ...published,
      revision: 4,
      items: published.items.map((item) => ({ ...item, layout: { ...item.layout, x: 0.125 } })),
    }),
  );
  expect(screen.getByRole("button", { name: "Right" })).toBeEnabled();
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
  await fireEvent.press(screen.getByRole("button", { name: "Burgundy wall" }));
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
  // The screen remounts on an owner change in the app; here the editor is closed by hand to reach the guest wall.
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  expect(screen.getByRole("button", { name: "Sign in" })).toBeOnTheScreen();
});

it("saves the final size only after a slider drag ends", async () => {
  await openWall();
  await fireEvent.press(screen.getByRole("button", { name: "Edit wall" }));
  await fireEvent.press(screen.getByRole("button", { name: "The Milkmaid" }));
  await fireEvent.press(screen.getByRole("button", { name: "Frame & photo" }));
  const slider = screen.getByRole("adjustable", { name: "Artwork size" });
  await fireEvent(slider, "editingChanged", true);
  await fireEvent(slider, "valueChange", 0.5);
  await fireEvent(slider, "valueChange", 0.6);
  expect(mockTransport.setLayout).not.toHaveBeenCalled();
  await fireEvent(slider, "editingChanged", false);
  await waitFor(() => expect(mockTransport.setLayout).toHaveBeenCalledTimes(1));
  expect(mockTransport.setLayout).toHaveBeenCalledWith(
    expect.objectContaining({
      items: [expect.objectContaining({ layout: expect.objectContaining({ width: 0.6 }) })],
    }),
    expect.anything(),
  );
});

it("saves an accessible slider adjustment without requiring a drag gesture", async () => {
  await openWall();
  await fireEvent.press(screen.getByRole("button", { name: "Edit wall" }));
  await fireEvent.press(screen.getByRole("button", { name: "The Milkmaid" }));
  await fireEvent.press(screen.getByRole("button", { name: "Frame & photo" }));
  await fireEvent(screen.getByRole("adjustable", { name: "Artwork size" }), "valueChange", 0.41);
  await waitFor(() => expect(mockTransport.setLayout).toHaveBeenCalledTimes(1));
  expect(mockTransport.setLayout).toHaveBeenCalledWith(
    expect.objectContaining({
      items: [expect.objectContaining({ layout: expect.objectContaining({ width: 0.41 }) })],
    }),
    expect.anything(),
  );
});

it("shows the empty wall instead of a spinner while the account scope is still missing", async () => {
  switchOwner("account:a");
  await render(<CollectionWall works={[]} onEditingChange={jest.fn()} />);
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

it("does not reload the wall when only the auth token rotates", async () => {
  const { result, rerender } = await renderHook(() => useCollectionWall([]));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(mockTransport.getMine).toHaveBeenCalledTimes(1);
  mockToken = "rotated-token";
  await rerender(undefined);
  expect(result.current.loading).toBe(false);
  expect(mockTransport.getMine).toHaveBeenCalledTimes(1);
});

it("offers profile creation when the account has no public profile", async () => {
  mockTransport.getMine.mockRejectedValue(new ConvexError({ code: "profile_required" }));
  await render(<CollectionWall works={[]} onEditingChange={jest.fn()} />);
  expect(await screen.findByRole("button", { name: "Create profile" })).toBeOnTheScreen();
});

it("clears a rendered wall immediately when its owner changes", async () => {
  await openWall();
  await act(() => {
    mockToken = null;
    switchOwner("device:guest", "guest-scope");
  });
  expect(screen.queryByRole("button", { name: "The Milkmaid" })).toBeNull();
  expect(screen.getByRole("button", { name: "Sign in" })).toBeOnTheScreen();
});

it.each([false, true])(
  "loads local draft artwork proportions, tolerating a missing photo (%s)",
  async (missing) => {
    const getSize = jest.spyOn(Image, "getSize").mockImplementation(async () => {
      if (missing) throw new Error("File missing");
      return { width: 600, height: 900 };
    });
    try {
      const works = [
        {
          localId: "save-b",
          cropPath: "crops/sunflowers.jpg",
          title: "Sunflowers",
          artist: "Vincent van Gogh",
        },
      ] as SavedWork[];
      const { result } = await renderHook(() => useCollectionWall(works));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(() => result.current.loadSelections());
      await act(() =>
        result.current.repository.setLayoutDraft({
          color: "#CDD0CA",
          items: [
            { placementId: "save-b", saveLocalId: "save-b", layout: published.items[0].layout },
          ],
        }),
      );
      expect(result.current.pieces[0].artwork.title).toBe("Sunflowers");
      expect(wallAspect(result.current.pieces[0])).toBeCloseTo(missing ? 1 : 600 / 900);
      expect(mockTransport.setLayout).not.toHaveBeenCalled();
    } finally {
      getSize.mockRestore();
    }
  },
);

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
    await fireEvent.press(await screen.findByRole("button", { name: "Hang Sunflowers" }));
    await waitFor(() =>
      expect(scrollTo).toHaveBeenCalledWith(
        expect.objectContaining({ animated: false, y: expect.any(Number) }),
      ),
    );
    const call = scrollTo.mock.calls.find(
      ([options]) => typeof options === "object" && options && "y" in options,
    );
    expect((call?.[0] as { y: number } | undefined)?.y).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Sunflowers" })).toBeOnTheScreen();
  } finally {
    scrollTo.mockRestore();
  }
});

it("keeps the horizontal artwork selector available after selecting and hanging art", async () => {
  mockTransport.listMine.mockResolvedValue({
    page: [
      { localId: "save-a", snapshot: { title: "The Milkmaid", artist: "Johannes Vermeer" } },
      { localId: "save-b", snapshot: { title: "Sunflowers", artist: "Vincent van Gogh" } },
    ],
    cursor: null,
    isDone: true,
  });
  await openWall();
  await fireEvent.press(screen.getByRole("button", { name: "Edit wall" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Select The Milkmaid" }));
  expect(screen.getByRole("button", { name: "Select The Milkmaid" })).toBeSelected();
  expect(screen.getByRole("button", { name: "Hang Sunflowers" })).toBeOnTheScreen();
  expect(mockTransport.setLayout).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Hang Sunflowers" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeEnabled());
  expect(screen.getByRole("button", { name: "Select Sunflowers" })).toBeSelected();
  await fireEvent.press(screen.getByRole("button", { name: "Select The Milkmaid" }));
  expect(screen.getByRole("button", { name: "Select The Milkmaid" })).toBeSelected();
  expect(mockTransport.setLayout).toHaveBeenCalledTimes(1);
});

it("shows a blank wall and opens Scan when there is no saved art", async () => {
  mockTransport.getMine.mockResolvedValue({ ...published, items: [] });
  await render(<CollectionWall works={[]} />);
  await fireEvent.press(await screen.findByRole("button", { name: "Scan artwork" }));
  expect(mockPush).toHaveBeenLastCalledWith("/scan");
  expect(screen.getByText("Add artworks to your wall.")).toBeOnTheScreen();
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
  await render(<CollectionWall works={[{ localId: "save-b" } as SavedWork]} />);
  await fireEvent.press(await screen.findByRole("button", { name: "Choose artworks" }));
  await fireEvent.press(await screen.findByRole("checkbox", { name: "Sunflowers" }));
  await fireEvent.press(screen.getByRole("button", { name: "Add 1 artwork to wall" }));
  expect(screen.getByRole("header", { name: "Edit wall" })).toBeOnTheScreen();
  expect(mockTransport.setLayout).toHaveBeenCalledWith(
    expect.objectContaining({ items: [expect.objectContaining({ saveLocalId: "save-b" })] }),
    expect.anything(),
  );
});
