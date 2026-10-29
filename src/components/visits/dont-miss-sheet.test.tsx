import { fireEvent, render, screen } from "@testing-library/react-native";

import type { MuseumPick } from "@/lib/venue/use-museum-picks";

import { DontMissSheet } from "./dont-miss-sheet";

let mockPicks: MuseumPick[] = [];
let mockLoading = false;
let mockError = false;
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ venueId: "met", artworkId: "wheat" }),
  router: { back: () => mockBack() },
}));
jest.mock("@/lib/venue/use-museum-picks", () => ({
  useMuseumPick: () => ({ pick: mockPicks[0], loading: mockLoading, error: mockError }),
}));
jest.mock("@/hooks/use-fitted-sheet", () => ({ useFittedFormSheetStyle: () => ({}) }));

const wheat: MuseumPick = {
  artworkId: "wheat" as never,
  title: "Wheat Field with Cypresses",
  artist: "Vincent van Gogh",
  date: "1889",
  medium: "Oil on canvas",
  thumbnailUrl: "https://museum.example/wheat.jpg",
  savers: 0,
};

beforeEach(() => {
  mockLoading = false;
  mockError = false;
  mockBack.mockClear();
});

it("shows the work larger with its artist, date and medium", async () => {
  mockPicks = [wheat];
  await render(<DontMissSheet />);
  expect(screen.getByRole("header", { name: "Wheat Field with Cypresses" })).toBeOnTheScreen();
  expect(screen.getByText("Vincent van Gogh · 1889")).toBeOnTheScreen();
  expect(screen.getByText("Oil on canvas")).toBeOnTheScreen();
  expect(screen.queryByText(/Saved here by/)).toBeNull();
});

it("says how many people saved it there once more than one has", async () => {
  mockPicks = [{ ...wheat, savers: 3 }];
  await render(<DontMissSheet />);
  expect(screen.getByText("Saved here by 3 people")).toBeOnTheScreen();
});

it("waits for the picks before showing anything", async () => {
  mockPicks = [];
  mockLoading = true;
  await render(<DontMissSheet />);
  expect(screen.getByRole("progressbar", { name: "Loading the artwork" })).toBeOnTheScreen();
});

it.each([
  [false, "This artwork is unavailable."],
  [true, "This artwork could not load."],
])("explains an unavailable artwork and lets the visitor close the sheet (error: %s)", async (error, message) => {
  mockPicks = [];
  mockError = error;
  await render(<DontMissSheet />);
  expect(screen.getByText(message)).toBeOnTheScreen();
  expect(screen.queryByRole("progressbar")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  expect(mockBack).toHaveBeenCalledTimes(1);
});
