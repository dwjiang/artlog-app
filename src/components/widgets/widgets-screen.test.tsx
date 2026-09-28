import { fireEvent, render, screen } from "@testing-library/react-native";

import type { WidgetSettings } from "@/lib/widgets/widget-settings";

import { WidgetsScreen } from "./widgets-screen";

const mockUpdate = jest.fn();
const mockArtwork = {
  id: "monet",
  title: "Water Lilies",
  artist: "Claude Monet",
  paths: [],
  uri: "file:///painting.jpg",
  aspect: 3.7,
  museum: "Musée de l’Orangerie",
  visitId: "paris",
  visitedOn: "2026-06-14",
};
let mockEmpty = false;

jest.mock("@/lib/widgets/widget-provider", () => ({
  useWidgetCollection: () => {
    const { useState } = jest.requireActual<typeof import("react")>("react");
    const { defaultWidgetSettings } = jest.requireActual("@/lib/widgets/widget-settings");
    const [preferences, setPreferences] = useState<WidgetSettings>(defaultWidgetSettings);
    return {
      preferences,
      update: (patch: Partial<WidgetSettings>) => {
        mockUpdate(patch);
        setPreferences((value) => ({ ...value, ...patch }));
      },
      prepared: mockEmpty ? [] : [mockArtwork],
      artworks: mockEmpty ? [] : [mockArtwork],
      allArtworks: mockEmpty ? [] : [mockArtwork],
      visits: [
        {
          localId: "paris",
          venueName: "Musée de l’Orangerie",
          visitedOn: "2026-06-14",
        },
      ],
      encounters: [{ savedLocalId: "monet", visitLocalId: "paris", deletedAt: null }],
      loading: false,
      syncing: false,
      retry: jest.fn(),
    };
  },
}));

beforeEach(() => {
  mockEmpty = false;
  mockUpdate.mockClear();
});

it("preserves medium settings while previewing the small widget", async () => {
  await render(<WidgetsScreen />);
  await fireEvent.press(screen.getByRole("button", { name: /^Caption,/ }));
  await fireEvent.press(screen.getByRole("button", { name: "Title + artist" }));
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  await fireEvent.press(screen.getByRole("button", { name: "Small" }));
  expect(screen.queryByRole("button", { name: /^Painting frame,/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /^Caption,/ })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Medium" }));
  expect(screen.getByRole("button", { name: "Caption, Title + artist" })).toBeOnTheScreen();
  expect(mockUpdate).toHaveBeenCalledTimes(1);
});

it("selects the actual visit or artwork and returns to the editor", async () => {
  await render(<WidgetsScreen />);
  await fireEvent.press(screen.getByRole("button", { name: /^Artwork source,/ }));
  await fireEvent.press(screen.getByRole("button", { name: /^A visit,/ }));
  await fireEvent.press(screen.getByRole("button", { name: /^Musée de l’Orangerie,/ }));
  expect(mockUpdate).toHaveBeenLastCalledWith({
    source: { kind: "visit", id: "paris" },
  });
  expect(screen.getByRole("button", { name: /Artwork source, A visit/ })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: /^Artwork source,/ }));
  await fireEvent.press(screen.getByRole("button", { name: /^One artwork,/ }));
  await fireEvent.press(screen.getByRole("button", { name: "Water Lilies, Claude Monet" }));
  expect(mockUpdate).toHaveBeenLastCalledWith({
    source: { kind: "artwork", id: "monet" },
  });
  expect(screen.getByRole("button", { name: "Artwork source, One artwork · Water Lilies" })).toBeOnTheScreen();
});

it("updates the preset color and frame, disabling width when unframed", async () => {
  await render(<WidgetsScreen />);
  await fireEvent.press(screen.getByRole("button", { name: /^Widget color,/ }));
  await fireEvent.press(screen.getByRole("button", { name: "Sage background" }));
  expect(mockUpdate).toHaveBeenLastCalledWith({ color: "sage" });
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  await fireEvent.press(screen.getByRole("button", { name: /^Painting frame,/ }));
  await fireEvent.press(screen.getByRole("button", { name: "No frame" }));
  expect(mockUpdate).toHaveBeenLastCalledWith({ frame: "none" });
  expect(screen.getByRole("button", { name: "Wide", disabled: true })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Walnut frame" }));
  await fireEvent.press(screen.getByRole("button", { name: "Wide", disabled: false }));
  expect(mockUpdate).toHaveBeenLastCalledWith({ frameWidth: "wide" });
});

it("shows all four setup steps together and dismisses with Got it", async () => {
  await render(<WidgetsScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "How to add the widget" }));
  expect(screen.getByRole("header", { name: "Add to Home Screen" })).toBeOnTheScreen();
  for (const text of [
    /an empty area on your Home Screen/,
    /at the top left, then Add Widget in the menu/,
    /and tap it\. Swipe to choose a size/,
    /Back on your Home Screen, tap Done/,
  ]) {
    expect(screen.getByText(text)).toBeOnTheScreen();
  }
  await fireEvent.press(screen.getByRole("button", { name: "Got it" }));
  expect(screen.queryByRole("header", { name: "Add to Home Screen" })).toBeNull();
});

it("explains how to populate an empty widget", async () => {
  mockEmpty = true;
  await render(<WidgetsScreen />);
  expect(screen.getByText("Save a painting to see it in your widget.")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "How to add the widget" })).toBeOnTheScreen();
});
