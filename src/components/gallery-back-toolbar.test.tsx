import { fireEvent, render, screen } from "@testing-library/react-native";
import {
  GalleryBackToolbar,
  previousScreenLabel,
} from "./gallery-back-toolbar";

const mockBack = jest.fn();
let mockState: Parameters<typeof previousScreenLabel>[0];
jest.mock("expo-router", () => {
  const { View } = jest.requireActual("react-native");
  return {
    router: { back: () => mockBack() },
    useNavigation: () => ({ getState: () => mockState }),
    Stack: { Screen: () => null, Toolbar: Object.assign(View, { View }) },
  };
});

const tabs = (tab: string, screen?: string) => ({
  name: "(tabs)",
  state: {
    index: 0,
    routes: [
      { name: tab, state: screen ? { routes: [{ name: screen }] } : undefined },
    ],
  },
});

it.each([
  [
    "the collection tab",
    [tabs("(collection)", "collection"), { name: "saved/[savedId]" }],
    "Collection",
  ],
  [
    "visits by museum inside the collection tab",
    [tabs("(collection)", "visit-place"), { name: "journal/[visitId]" }],
    "Visits",
  ],
  [
    "a tab that has not rendered its stack yet",
    [tabs("(home)"), { name: "people" }],
    "Home",
  ],
  [
    "a scan result under the saved artwork",
    [tabs("(scan)"), { name: "result/[scanId]" }, { name: "saved/[savedId]" }],
    "Result",
  ],
  [
    "the leaderboard under people",
    [tabs("(home)"), { name: "leaderboards" }, { name: "people" }],
    "Leaderboards",
  ],
])("names %s", (_, routes, label) => {
  expect(previousScreenLabel({ index: routes.length - 1, routes })).toBe(label);
});

it("has no name for an unlisted screen or the first route", () => {
  expect(
    previousScreenLabel({
      index: 1,
      routes: [{ name: "index" }, { name: "preview" }],
    }),
  ).toBeUndefined();
  expect(
    previousScreenLabel({ index: 0, routes: [{ name: "settings" }] }),
  ).toBeUndefined();
  expect(previousScreenLabel(undefined)).toBeUndefined();
});

it("labels the back button after the screen underneath and pops on press", async () => {
  mockState = {
    index: 1,
    routes: [tabs("(collection)", "collection"), { name: "settings" }],
  };
  await render(<GalleryBackToolbar />);
  await fireEvent.press(
    screen.getByRole("button", { name: "Back to Collection" }),
  );
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it("falls back to a plain Back label", async () => {
  mockState = { index: 1, routes: [{ name: "index" }, { name: "preview" }] };
  await render(<GalleryBackToolbar />);
  expect(screen.getByRole("button", { name: "Back" })).toHaveTextContent(
    "Back",
  );
});
