import { fireEvent, render, screen } from "@testing-library/react-native";
import { Platform } from "react-native";

import { MuseumMap } from "./museum-map";

jest.mock("@/lib/venue/venue-db", () => ({ venueMetadataForIds: jest.fn() }));
jest.mock("expo-maps", () => {
  const { Pressable, Text } = jest.requireActual("react-native");
  return {
    AppleMaps: {
      MapColorScheme: { LIGHT: "light" },
      View: ({ onMarkerClick }: { onMarkerClick?: (marker: { id: string }) => void }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Neue pin"
          onPress={() => onMarkerClick?.({ id: "neue" })}
        >
          <Text>Nearby museum map</Text>
        </Pressable>
      ),
    },
  };
});

const pins = [
  { key: "met", name: "The Met", lat: 40.779, lng: -73.963 },
  { key: "neue", name: "Neue Galerie", lat: 40.781, lng: -73.96 },
];
afterEach(() => jest.restoreAllMocks());

it("uses a noninteractive preview on iOS 17 and directs selection to the list", async () => {
  jest.spyOn(Platform, "Version", "get").mockReturnValue("17.7");
  const select = jest.fn();
  await render(<MuseumMap center={pins[0]} pins={pins} selectedKey="met" onSelect={select} />);
  expect(screen.getByText("Choose a museum from the list below.")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Neue pin" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Neue pin", includeHiddenElements: true }));
  expect(select).not.toHaveBeenCalled();
});

it("selects a museum through its pin on iOS 18 and later", async () => {
  jest.spyOn(Platform, "Version", "get").mockReturnValue("18.0");
  const select = jest.fn();
  await render(<MuseumMap center={pins[0]} pins={pins} selectedKey="met" onSelect={select} />);
  await fireEvent.press(screen.getByRole("button", { name: "Neue pin" }));
  expect(select).toHaveBeenCalledWith("neue");
  expect(screen.queryByText("Choose a museum from the list below.")).toBeNull();
});
