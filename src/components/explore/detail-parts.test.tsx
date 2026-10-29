import { fireEvent, render, screen } from "@testing-library/react-native";
import { Linking } from "react-native";

import { LocationPreview } from "./detail-parts";

jest.mock("./location-map", () => ({
  LocationMap: () => jest.requireActual("react").createElement(jest.requireActual("react-native").Text, null, "Map"),
}));

const museum = { id: "asian", name: "Asian Art Museum", lat: 37.78, lng: -122.416 };

it("keeps the page's drags off the map and opens the museum in Maps on a tap", async () => {
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
  await render(<LocationPreview museum={museum} />);
  expect(screen.getByText("Map").parent?.props.pointerEvents).toBe("none");
  await fireEvent.press(screen.getByRole("button", { name: "Map of Asian Art Museum" }));
  expect(open).toHaveBeenCalledWith("https://maps.apple.com/?ll=37.78,-122.416&q=Asian%20Art%20Museum");
});
