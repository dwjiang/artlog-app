import { fireEvent, render, screen } from "@testing-library/react-native";

import { CaptureContextButton } from "./capture-context-button";

const mockPush = jest.fn();
jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
jest.mock("expo-router", () => ({
  useFocusEffect: (callback: () => void) => jest.requireActual("react").useEffect(callback, [callback]),
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));
jest.mock("@/lib/venue/venue-db", () => ({
  venueMetadataForIds: async () => [
    {
      id: "museum-met",
      key: "k",
      name: "Metropolitan Museum of Art",
      lat: 40.78,
      lng: -73.96,
      website: null,
      region: "new-york",
    },
  ],
}));

const capturedAt = Date.UTC(2026, 8, 1, 16);
const atMuseum = {
  photoPath: "photo.jpg",
  venueId: "museum-met" as never,
  capturedAt,
};

it("leads the save-bar row with the day so a long museum name truncates first", async () => {
  await render(<CaptureContextButton capture={atMuseum} variant="row" />);
  await fireEvent.press(
    await screen.findByRole("button", {
      name: "Visit: 1 Sep 2026 · Metropolitan Museum of Art · Change",
    }),
  );
  expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/capture-context" }));
});

it("names a capture without a visit in both variants", async () => {
  const view = await render(<CaptureContextButton capture={{ photoPath: "photo.jpg" }} />);
  expect(await screen.findByRole("button", { name: "No visit · Change" })).toBeOnTheScreen();
  await view.rerender(<CaptureContextButton capture={{ photoPath: "photo.jpg" }} variant="row" />);
  expect(await screen.findByRole("button", { name: "Visit: None · Change" })).toBeOnTheScreen();
});
