import { fireEvent, render as renderComponent, screen } from "@testing-library/react-native";
import { useState, type ReactElement, type ReactNode } from "react";
import { Dimensions } from "react-native";
import { SafeAreaProvider, type SafeAreaProviderProps } from "react-native-safe-area-context";

import type { SavedWork } from "@/db/schema";
import { playToggleHaptic } from "@/lib/ui/haptics";
import type { WallPiece } from "@/lib/wall/wall-layout";
import { LIMITS } from "@/shared/journal/limits";

import { WallArtworkPicker } from "./wall-artwork-picker";

jest.mock("expo-router", () => ({ useSegments: () => [] }));
jest.mock("@/lib/ui/haptics");

jest.mock("react-native-safe-area-context", () => {
  const actual = jest.requireActual("react-native-safe-area-context");
  return {
    ...actual,
    SafeAreaProvider: (props: SafeAreaProviderProps) => (
      <actual.SafeAreaProvider {...props} testID="native-safe-area" />
    ),
  };
});

const originalWindow = Dimensions.get("window");
beforeEach(() => Dimensions.set({ window: { ...originalWindow, fontScale: 1 } }));
afterEach(() => Dimensions.set({ window: originalWindow }));

function PresentingTab({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 300, y: 0, width: 651, height: 669 },
        insets: { top: 0, bottom: 0, left: 0, right: 84 },
      }}
    >
      {children}
    </SafeAreaProvider>
  );
}

function render(ui: ReactElement) {
  return renderComponent(ui, { wrapper: PresentingTab });
}
const work = (localId: string, title: string, artist: string, savedAt = 1): SavedWork =>
  ({
    localId,
    title,
    artist,
    savedAt,
    owner: "account:a",
    deletedAt: null,
    syncedBy: "device-a",
    cropPath: null,
  }) as SavedWork;
const works = [work("a", "Sunflowers", "Vincent van Gogh"), work("b", "Water Lilies", "Claude Monet", 2)];
const onAdd = jest.fn();
function Picker({
  count = 0,
  pieces = [],
  artworks = works,
}: {
  count?: number;
  pieces?: WallPiece[];
  artworks?: SavedWork[];
}) {
  const [selectedIds, onChange] = useState<string[]>([]);
  return (
    <WallArtworkPicker
      works={artworks}
      visits={[{ localId: "paris", venueName: "Orsay", visitedOn: "2026-09-20", works: [works[1]] }]}
      pieces={pieces}
      selectedIds={selectedIds}
      count={count}
      signedIn
      disabled={false}
      onChange={onChange}
      onDismiss={jest.fn()}
      onAdd={() => onAdd(selectedIds)}
    />
  );
}

it("fits the modal's own frame after rotation while keeping selected artworks", async () => {
  await render(<Picker />);
  const providers = screen.getAllByTestId("native-safe-area");
  expect(providers).toHaveLength(2);
  const modalProvider = providers[1];
  await fireEvent(modalProvider, "insetsChange", {
    nativeEvent: {
      frame: { x: 0, y: 0, width: 951, height: 669 },
      insets: { top: 0, bottom: 0, left: 0, right: 84 },
    },
  });
  expect(screen.getByRole("checkbox", { name: "Sunflowers" })).toHaveStyle({ width: 197.75 });
  await fireEvent.press(screen.getByRole("checkbox", { name: "Sunflowers" }));

  await fireEvent(modalProvider, "insetsChange", {
    nativeEvent: {
      frame: { x: 0, y: 0, width: 402, height: 874 },
      insets: { top: 62, bottom: 34, left: 0, right: 0 },
    },
  });
  expect(screen.getByRole("checkbox", { name: "Sunflowers" })).toHaveStyle({ width: 175 });
  expect(screen.getByRole("checkbox", { name: "Sunflowers" })).toBeChecked();
  await fireEvent.press(screen.getByRole("button", { name: "Add 1 artwork to wall" }));
  expect(onAdd).toHaveBeenLastCalledWith(["a"]);
});

it("limits selection to remaining wall space and releases space when unchecked", async () => {
  jest.mocked(playToggleHaptic).mockClear();
  await render(<Picker count={LIMITS.wallItems - 1} />);
  expect(screen.getByRole("button", { name: "Add artworks to wall" })).toBeDisabled();
  await fireEvent.press(screen.getByRole("checkbox", { name: "Sunflowers" }));
  expect(screen.getByRole("checkbox", { name: "Sunflowers" })).toBeChecked();
  expect(playToggleHaptic).toHaveBeenLastCalledWith(true);
  expect(screen.getByRole("checkbox", { name: "Water Lilies" })).toBeDisabled();
  await fireEvent.press(screen.getByRole("checkbox", { name: "Sunflowers" }));
  expect(playToggleHaptic).toHaveBeenLastCalledWith(false);
  expect(screen.getByRole("checkbox", { name: "Water Lilies" })).toBeEnabled();
});

it("keeps selections across searches, visit filters, sorting, and review", async () => {
  await render(<Picker />);
  await fireEvent.press(screen.getByRole("checkbox", { name: "Sunflowers" }));
  await fireEvent.changeText(screen.getByLabelText("Search artworks"), "monet");
  expect(screen.queryByRole("checkbox", { name: "Sunflowers" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Orsay · 20 Sep 2026" }));
  await fireEvent.press(screen.getByRole("button", { name: "Title" }));
  await fireEvent.press(screen.getByRole("checkbox", { name: "Water Lilies" }));
  await fireEvent.press(screen.getByRole("button", { name: "Review selected artworks" }));
  expect(screen.getByRole("checkbox", { name: "Sunflowers" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Water Lilies" })).toBeChecked();
  await fireEvent.press(screen.getByRole("checkbox", { name: "Sunflowers" }));
  await fireEvent.press(screen.getByRole("button", { name: "Library" }));
  expect(screen.getByLabelText("Search artworks")).toHaveProp("value", "monet");
  expect(screen.getByRole("checkbox", { name: "Water Lilies" })).toBeChecked();
  await fireEvent.press(screen.getByRole("button", { name: "Add 1 artwork to wall" }));
  expect(onAdd).toHaveBeenLastCalledWith(["b"]);
});

it("searches artworks beyond the initially rendered rows", async () => {
  const many = Array.from({ length: 250 }, (_, index) =>
    work(`work-${index}`, `Artwork ${index}`, "Painter", 250 - index),
  );
  many.push(work("last", "Evening light", "Georgia O’Keeffe", 0));
  await render(<Picker artworks={many} />);
  expect(screen.queryByRole("checkbox", { name: "Evening light" })).toBeNull();
  await fireEvent.changeText(screen.getByLabelText("Search artworks"), "Georgia");
  expect(screen.getByRole("checkbox", { name: "Evening light" })).toBeEnabled();
});

it("hides hung artworks by default and prevents adding hung or unsynced artworks", async () => {
  await render(
    <Picker
      pieces={[{ saveLocalId: "a" } as WallPiece]}
      artworks={[...works, { ...work("c", "New painting", "Artist"), syncedBy: null }]}
    />,
  );
  expect(screen.queryByRole("checkbox", { name: "Sunflowers" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "All Artworks" }));
  expect(screen.getByRole("checkbox", { name: "Sunflowers" })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "Sunflowers" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "New painting" })).toBeDisabled();
});

it("clears selection from review without changing the library filters", async () => {
  await render(<Picker />);
  await fireEvent.changeText(screen.getByLabelText("Search artworks"), "sunflowers");
  await fireEvent.press(screen.getByRole("checkbox", { name: "Sunflowers" }));
  await fireEvent.press(screen.getByRole("button", { name: "Review selected artworks" }));
  await fireEvent.press(screen.getByRole("button", { name: "Clear selection" }));
  expect(screen.getByText("No artworks selected")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Add artworks to wall" })).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: "Library" }));
  expect(screen.getByLabelText("Search artworks")).toHaveProp("value", "sunflowers");
});

it("offers recovery when the artwork library could not load", async () => {
  const retry = jest.fn();
  await render(
    <WallArtworkPicker
      works={[]}
      pieces={[]}
      selectedIds={[]}
      count={0}
      signedIn={false}
      disabled={false}
      error="Your collection could not load. Try again."
      onRetry={retry}
      onChange={jest.fn()}
      onDismiss={jest.fn()}
      onAdd={jest.fn()}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(/Your collection could not load/);
  expect(screen.queryByText("No saved artworks yet")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
  expect(retry).toHaveBeenCalledTimes(1);
});
