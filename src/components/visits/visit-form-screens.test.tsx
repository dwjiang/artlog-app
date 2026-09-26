import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { selectArtworkEncounters } from "@/db/repos/artwork-album";
import { insertSavedWork } from "@/db/repos/saved-works";
import { getVisit, listVisits } from "@/db/repos/visits";
import { anonymousOwner, switchOwner } from "@/lib/account/owner-store";
import { pickerDate } from "@/lib/journal/visit-date";

import { VisitCreateScreen, VisitMuseumScreen } from "./visit-form-screens";

const mockBack = jest.fn();
const mockDismissTo = jest.fn();
const mockSearchByName = jest.fn();
const mockConfirmPlace = jest.fn();
const mockMove = jest.fn();
const mockMovingVisit = {
  localId: "visit-1",
  owner: "device:test-installation",
  venueId: "museum",
  venueName: "Museum of Art",
  visitedOn: "2026-09-16",
  timeZone: "Asia/Tokyo",
};
let mockSavedId: string | undefined;
const mockVenue = {
  id: "museum",
  name: "Museum of Art",
  city: "New York",
  lat: 40.78,
  lng: -73.96,
  country: "US",
  region: "new-york",
};
const mockIsland = {
  id: "island",
  name: "Island Museum",
  lat: -19.05,
  lng: -169.92,
  region: "country:NU",
};
jest.mock("expo-crypto", () => ({
  randomUUID: () => jest.requireActual("node:crypto").randomUUID(),
}));
jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
jest.mock("@/lib/venue/search-venues", () => ({
  MUSEUM_SEARCH_LIMIT: 30,
  searchVenues: async (query: string) => (/^fr/i.test(query) ? [] : [mockVenue, mockIsland]),
}));
jest.mock("../../../modules/poi-search/src", () => ({
  getPoiSearch: () => ({
    searchByName: (...args: unknown[]) => mockSearchByName(...args),
  }),
}));
jest.mock("@/lib/venue/use-venue", () => ({
  useVenue: () => ({ fix: { lat: 37.77, lng: -122.42, at: 1 }, move: mockMove }),
  confirmPlace: (...args: unknown[]) => mockConfirmPlace(...args),
}));
jest.mock("@/lib/journal/use-visits", () => ({
  useVisits: () => ({ owner: mockMovingVisit.owner, visits: [mockMovingVisit], loading: false }),
}));
jest.mock("@/lib/venue/venue-db", () => ({
  venueMetadataForIds: async () => [mockVenue],
  onVenueMetadataChange: () => () => {},
}));
jest.mock("expo-router", () => {
  const { Pressable, Text, View } = jest.requireActual("react-native");
  return {
    router: {
      back: () => mockBack(),
      dismissTo: (...args: unknown[]) => mockDismissTo(...args),
    },
    useFocusEffect: (effect: () => void) => jest.requireActual("react").useEffect(effect, []),
    useLocalSearchParams: () => ({ savedId: mockSavedId, visitId: mockMovingVisit.localId }),
    Stack: {
      Toolbar: Object.assign(View, {
        View,
        Button: ({ children, onPress, disabled }: { children: ReactNode; onPress: () => void; disabled?: boolean }) => (
          <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}>
            <Text>{children}</Text>
          </Pressable>
        ),
      }),
    },
  };
});
beforeEach(() => {
  mockSavedId = undefined;
  mockBack.mockClear();
  mockDismissTo.mockClear();
  mockSearchByName.mockReset().mockResolvedValue([]);
  mockConfirmPlace.mockReset();
  mockMove.mockReset().mockResolvedValue(undefined);
  switchOwner(anonymousOwner(), "scope-form");
});
afterEach(() => jest.restoreAllMocks());
async function fill() {
  await fireEvent.changeText(screen.getByLabelText("Search museums"), "museum");
  await fireEvent.press(
    await screen.findByRole("button", {
      name: "Museum of Art, New York, United States",
    }),
  );
  await fireEvent.changeText(screen.getByLabelText("Visit date"), "2024-02-29T12:00:00");
}

it("creates repeat visits with fresh UUIDs, no artworks, a museum timezone, and notes", async () => {
  const first = await render(<VisitCreateScreen />);
  expect(screen.getByRole("button", { name: "Add visit" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: /Public notes|Private notes/ })).toBeNull();
  await fill();
  await fireEvent.changeText(screen.getByLabelText("Notes"), "Private memory");
  await fireEvent.press(screen.getByRole("button", { name: "Add visit" }));
  expect(screen.queryByRole("alert")).toBeNull();
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  const firstVisit = (await listVisits())[0];
  expect(firstVisit).toMatchObject({
    visitedOn: "2024-02-29",
    timeZone: "America/New_York",
    reflection: "Private memory",
  });
  await first.unmount();
  await render(<VisitCreateScreen />);
  await fill();
  await fireEvent.press(screen.getByRole("button", { name: "Add visit" }));
  const repeats = await listVisits();
  expect(repeats).toHaveLength(2);
  expect(new Set(repeats.map((row) => row.localId)).size).toBe(2);
});

it("rejects future dates and clears form drafts when the owner changes", async () => {
  await render(<VisitCreateScreen />);
  await fill();
  await fireEvent.changeText(screen.getByLabelText("Visit date"), "2099-01-01T12:00:00");
  expect(screen.getByRole("button", { name: "Add visit" })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText("Notes"), "Secret");
  await act(() => switchOwner("account:other", "scope-other"));
  expect(screen.getByLabelText("Notes")).toHaveProp("value", "");
  expect(screen.getByLabelText("Search museums")).toBeOnTheScreen();
});

it("moves the default date back to the museum day when the device is already on the next day", async () => {
  // 10:00 UTC is the 16th everywhere east of UTC-10 but still the 15th on Niue (UTC-11).
  jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-16T10:00:00Z"));
  await render(<VisitCreateScreen />);
  await fireEvent.changeText(screen.getByLabelText("Search museums"), "island");
  await fireEvent.press(await screen.findByRole("button", { name: "Island Museum, Niue" }));
  expect(screen.getByLabelText("Visit date")).toHaveProp("value", pickerDate("2026-09-15").toISOString());
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("button", { name: "Add visit" })).toBeEnabled();
});

it("creates a linked visit and returns to that artwork in its new visit context", async () => {
  mockSavedId = "linked-work";
  await insertSavedWork({
    localId: mockSavedId,
    title: "Garden",
    artist: "Artist",
    savedAt: 1,
  });
  await render(<VisitCreateScreen />);
  await fill();
  await fireEvent.press(screen.getByRole("button", { name: "Add visit" }));
  await waitFor(() => expect(mockDismissTo).toHaveBeenCalled());
  const { params } = mockDismissTo.mock.calls[0][0];
  expect(params.savedId).toBe(mockSavedId);
  expect(await getVisit(params.visitId)).toMatchObject({
    venueName: "Museum of Art",
  });
  expect(selectArtworkEncounters().all()).toContainEqual(
    expect.objectContaining({
      savedLocalId: mockSavedId,
      visitLocalId: params.visitId,
      deletedAt: null,
    }),
  );
  expect(mockBack).not.toHaveBeenCalled();
});

it("cancels a pending linked visit without creating a visit or encounter", async () => {
  mockSavedId = "cancel-work";
  await insertSavedWork({
    localId: mockSavedId,
    title: "Garden",
    artist: "Artist",
    savedAt: 1,
  });
  const before = (await listVisits()).length;
  await render(<VisitCreateScreen />);
  await fill();
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(await listVisits()).toHaveLength(before);
  expect(
    selectArtworkEncounters()
      .all()
      .some((entry) => entry.savedLocalId === mockSavedId),
  ).toBe(false);
});

describe("a museum our table does not know", () => {
  const place = {
    name: "Fraenkel Gallery",
    lat: 37.79,
    lng: -122.4,
    category: "store",
    city: "San Francisco",
    country: "US",
    distanceMeters: 1200,
  };
  const row = {
    id: "id-fraenkel",
    key: "poi:1",
    name: "Fraenkel Gallery",
    lat: 37.79,
    lng: -122.4,
    website: null,
    region: "country:US",
    city: "San Francisco",
    cityKey: null,
    country: "US",
  };

  it("falls back to Apple Maps near the last fix and adds the chosen place as the museum for this visit", async () => {
    mockSearchByName.mockResolvedValue([place]);
    mockConfirmPlace.mockResolvedValue(row);
    await render(<VisitCreateScreen />);
    await fireEvent.changeText(screen.getByLabelText("Search museums"), "fraenkel");
    expect(await screen.findByRole("header", { name: "From Apple Maps" })).toBeOnTheScreen();
    expect(mockSearchByName).toHaveBeenCalledWith("fraenkel", 37.77, -122.42);
    await fireEvent.press(
      screen.getByRole("button", {
        name: "Fraenkel Gallery, San Francisco, United States",
      }),
    );
    await waitFor(() =>
      expect(mockConfirmPlace).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "poi",
          name: "Fraenkel Gallery",
          lat: 37.79,
          lng: -122.4,
          city: "San Francisco",
          country: "US",
        }),
        expect.any(Function),
      ),
    );
    expect(await screen.findByRole("button", { name: "Change museum" })).toBeOnTheScreen();
    expect(screen.getByText("Fraenkel Gallery")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText("Visit date"), "2024-02-29T12:00:00");
    await fireEvent.press(screen.getByRole("button", { name: "Add visit" }));
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect((await listVisits()).find((row) => row.venueId === "id-fraenkel")).toMatchObject({
      venueName: "Fraenkel Gallery",
      visitedOn: "2024-02-29",
      timeZone: "America/Los_Angeles",
    });
  });

  it("does not ask Apple Maps while our table has matches or the name is too short", async () => {
    await render(<VisitCreateScreen />);
    await fireEvent.changeText(screen.getByLabelText("Search museums"), "museum");
    await screen.findByRole("button", {
      name: "Museum of Art, New York, United States",
    });
    await fireEvent.changeText(screen.getByLabelText("Search museums"), "fr");
    expect(await screen.findByText("No museums found.")).toBeOnTheScreen();
    expect(screen.getByText("Type more of the name to search Apple Maps too.")).toBeOnTheScreen();
    expect(mockSearchByName).not.toHaveBeenCalled();
  });

  it("offers a retry when Apple Maps fails, naming Apple Maps rather than the table that answered", async () => {
    mockSearchByName.mockRejectedValueOnce(new Error("offline")).mockResolvedValue([place]);
    await render(<VisitCreateScreen />);
    await fireEvent.changeText(screen.getByLabelText("Search museums"), "fraenkel");
    expect(await screen.findByText("Apple Maps could not be reached. Try again.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("button", {
        name: "Fraenkel Gallery, San Francisco, United States",
      }),
    ).toBeOnTheScreen();
  });

  it("keeps the search open when Apple Maps has nothing or the museum cannot be added", async () => {
    await render(<VisitCreateScreen />);
    await fireEvent.changeText(screen.getByLabelText("Search museums"), "fraenkel");
    expect(await screen.findByText("No museums found.")).toBeOnTheScreen();
    expect(screen.queryByRole("header", { name: "From Apple Maps" })).toBeNull();
    mockSearchByName.mockResolvedValue([place]);
    mockConfirmPlace.mockRejectedValue(new Error("offline"));
    await fireEvent.changeText(screen.getByLabelText("Search museums"), "fraenkel gallery");
    await fireEvent.press(
      await screen.findByRole("button", {
        name: "Fraenkel Gallery, San Francisco, United States",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/This museum could not be added\./);
    expect(screen.getByLabelText("Search museums")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Add visit" })).toBeDisabled();
  });
});

describe("changing a visit's museum", () => {
  it("moves the visit to the chosen museum, keeping a day that has not begun there yet at the museum's today", async () => {
    // 10:00 UTC on the 16th is still the 15th on Niue (UTC-11).
    jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-16T10:00:00Z"));
    switchOwner(mockMovingVisit.owner);
    await render(<VisitMuseumScreen />);
    await fireEvent.changeText(screen.getByLabelText("Search museums"), "island");
    await fireEvent.press(await screen.findByRole("button", { name: "Island Museum, Niue" }));
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(mockMove).toHaveBeenCalledWith("visit-1", {
      venueId: "island",
      venueName: "Island Museum",
      timeZone: "Pacific/Niue",
      visitedOn: "2026-09-15",
    });
  });

  it("closes without a change for the same museum and keeps the search open when the move fails", async () => {
    switchOwner(mockMovingVisit.owner);
    await render(<VisitMuseumScreen />);
    await fireEvent.changeText(screen.getByLabelText("Search museums"), "museum");
    await fireEvent.press(await screen.findByRole("button", { name: "Museum of Art, New York, United States" }));
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockMove).not.toHaveBeenCalled();
    mockMove.mockRejectedValue(new Error("disk full"));
    await fireEvent.press(screen.getByRole("button", { name: "Island Museum, Niue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The museum could not be changed. Try again.");
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

it.each(["cancel", "dismiss"])("%s ignores a pending Apple Maps choice after leaving the sheet", async (method) => {
  mockSearchByName.mockResolvedValue([
    { name: "Fraenkel Gallery", lat: 37.79, lng: -122.4, city: "San Francisco", country: "US", category: "artGallery" },
  ]);
  let finish!: (row: typeof mockIsland) => void;
  mockConfirmPlace.mockImplementation((_place, wanted) =>
    new Promise<typeof mockIsland>((resolve) => {
      finish = resolve;
    }).then((row) => (wanted() ? row : undefined)),
  );
  const rendered = await render(<VisitMuseumScreen />);
  await fireEvent.changeText(screen.getByLabelText("Search museums"), "fraenkel");
  await fireEvent.press(await screen.findByRole("button", { name: "Fraenkel Gallery, San Francisco, United States" }));
  if (method === "cancel") await fireEvent.press(screen.getByText("Cancel"));
  else await rendered.unmount();
  await act(async () => finish(mockIsland));
  expect(mockMove).not.toHaveBeenCalled();
  expect(mockBack).toHaveBeenCalledTimes(method === "cancel" ? 1 : 0);
});
