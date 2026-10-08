import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { Dimensions, Linking } from "react-native";

import { removeSetting } from "@/db/repos/settings";
import { setMeasurementUnits } from "@/lib/settings/measurement-units";
import type { VenueView } from "@/lib/venue/use-venue";
import type { CurrentVisit, VenueOption } from "@/lib/venue/venue-reducer";

import { VenuePickerSheet } from "./venue-picker-sheet";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
jest.mock("@/lib/venue/search-venues", () => ({ searchVenues: jest.fn() }));
jest.mock("@/hooks/use-reduced-motion", () => ({
  useReducedMotion: () => true,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}));

const mockBack = jest.fn();
const mockConfirm = jest.fn();
const mockDismiss = jest.fn();
const mockDeclinePrompt = jest.fn();
const mockResolve = jest.fn();
const mockEnd = jest.fn();
const mockStartVisit = jest.fn();
const mockToast = jest.fn();
let mockView: VenueView;
let mockLocation: { granted: boolean; canAskAgain: boolean } | null = null;
let mockRequestLocation: () => Promise<{ granted: boolean }>;
let mockParams: { mode?: string } = {};
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock("@/lib/venue/use-venue", () => ({ useVenue: () => mockView }));
jest.mock("@/lib/ui/toast", () => ({ showToast: (message: string) => mockToast(message) }));
jest.mock("./museum-map", () => ({
  MuseumMap: () => null,
  useOptionCoordinates: () => new Map(),
}));
jest.mock("expo-location", () => ({
  useForegroundPermissions: () => [mockLocation, () => mockRequestLocation()],
}));

const seeded: VenueOption = {
  kind: "seeded",
  venueId: "id-met" as never,
  name: "Metropolitan Museum of Art",
  distanceM: 42,
  website: "https://www.metmuseum.org/",
};
const neighbour: VenueOption = {
  kind: "seeded",
  venueId: "id-neue" as never,
  name: "Neue Galerie",
  distanceM: 310,
};
const poi: VenueOption = {
  kind: "poi",
  name: "Corner Gallery",
  lat: 1,
  lng: 2,
  distanceM: 1250,
  category: "landmark",
};
const visit: CurrentVisit = {
  localId: "visit-1",
  venueId: "id-met" as never,
  venueName: "Metropolitan Museum of Art",
  startedAt: Date.UTC(2026, 8, 18, 21, 10),
  visitedOn: "2026-09-18",
  timeZone: "America/New_York",
};

beforeEach(async () => {
  await removeSetting("measurement-units");
  jest.resetAllMocks();
  mockConfirm.mockImplementation(async (option: VenueOption) =>
    option.kind === "seeded" ? option.venueId : "id-confirmed-place",
  );
  mockEnd.mockResolvedValue(undefined);
  mockStartVisit.mockImplementation(async (venueId: string) => ({ ...visit, localId: "visit-new", venueId }));
  mockParams = {};
  mockLocation = { granted: false, canAskAgain: false };
  mockRequestLocation = async () => ({ granted: true });
  mockView = {
    hydrated: true,
    status: "choose",
    options: [seeded, neighbour],
    resolve: mockResolve,
    confirm: mockConfirm,
    dismiss: mockDismiss,
    declinePrompt: mockDeclinePrompt,
    promptChooser: jest.fn(),
    end: mockEnd,
    startVisit: mockStartVisit,
    move: jest.fn(),
  };
});

describe("the location prompt", () => {
  beforeEach(() => {
    mockParams = { mode: "choose" };
  });

  it("asks to start a visit on a map with the nearest museum selected, and starts it at the chosen museum", async () => {
    await render(<VenuePickerSheet />);
    expect(screen.getByRole("header", { name: "Start a visit?" })).toBeOnTheScreen();
    expect(screen.getByRole("radio", { name: seeded.name })).toBeChecked();
    expect(screen.getByRole("radio", { name: neighbour.name })).not.toBeChecked();
    await fireEvent.press(screen.getByRole("radio", { name: neighbour.name }));
    expect(screen.getByRole("radio", { name: neighbour.name })).toBeChecked();
    expect(mockConfirm).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Start visit" }));
    expect(mockConfirm).toHaveBeenCalledWith(neighbour, expect.anything());
    expect(mockStartVisit).toHaveBeenCalledWith("id-neue", {
      signal: expect.any(AbortSignal),
      replaceVisitLocalId: undefined,
    });
    expect(mockEnd).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith("Visit started.");
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("starts the visit at a museum found through search", async () => {
    const { searchVenues } = jest.requireMock("@/lib/venue/search-venues");
    searchVenues.mockResolvedValue([
      {
        id: "id-frick",
        key: "wikidata:Q682827",
        name: "The Frick Collection",
        lat: 40.7711,
        lng: -73.9674,
        website: null,
        region: "new-york",
        city: "New York",
        cityKey: "new-york",
        country: "US",
      },
    ]);
    await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole("button", { name: "Search for another museum" }));
    await fireEvent.changeText(screen.getByLabelText("Search museums"), "Frick");
    await fireEvent.press(await screen.findByRole("button", { name: "The Frick Collection" }));
    expect(mockStartVisit).toHaveBeenCalledWith("id-frick", {
      signal: expect.any(AbortSignal),
      replaceVisitLocalId: undefined,
    });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("keeps the prompt open with a message when the visit cannot start", async () => {
    mockStartVisit.mockRejectedValue(new Error("disk full"));
    const view = await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole("button", { name: "Start visit" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t start the visit. Try again.");
    expect(mockToast).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
    mockStartVisit.mockResolvedValue({ ...visit, localId: "visit-new", venueId: seeded.venueId });
    await fireEvent.press(screen.getByRole("button", { name: "Start visit" }));
    expect(mockBack).toHaveBeenCalledTimes(1);
    await view.unmount();
    expect(mockDeclinePrompt).not.toHaveBeenCalled();
  });

  it('leaves the spot undecided with "Not at a museum" and can switch to the search list', async () => {
    const view = await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole("button", { name: "Not at a museum" }));
    expect(mockDismiss).toHaveBeenCalledTimes(1);
    expect(mockConfirm).not.toHaveBeenCalled();
    await view.unmount();
    expect(mockDeclinePrompt).not.toHaveBeenCalled();
    await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole("button", { name: "Search for another museum" }));
    expect(screen.getByRole("header", { name: "Choose museum" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: seeded.name })).toBeOnTheScreen();
  });

  it("pins Start visit and the search below a long museum list, and scrolls them with it at accessibility text sizes", async () => {
    const window = Dimensions.get("window");
    mockView.options = Array.from({ length: 12 }, (_, index) => ({ ...neighbour, name: `Gallery ${index + 1}` }));
    try {
      Dimensions.set({ window: { ...window, fontScale: 1 } });
      await render(<VenuePickerSheet />);
      const list = () => within(screen.getByLabelText("Nearby museums"));
      expect(list().getByRole("radio", { name: "Gallery 12" })).toBeOnTheScreen();
      expect(list().queryByRole("button", { name: "Start visit" })).toBeNull();
      expect(list().queryByRole("button", { name: "Search for another museum" })).toBeNull();
      await act(() => Dimensions.set({ window: { ...window, fontScale: 3.12 } }));
      expect(list().getByRole("button", { name: "Start visit" })).toBeOnTheScreen();
      expect(list().getByRole("button", { name: "Search for another museum" })).toBeOnTheScreen();
    } finally {
      Dimensions.set({ window });
    }
  });
});

describe("choosing a museum", () => {
  it("uses saved imperial units and updates when the preference changes", async () => {
    await setMeasurementUnits("imperial");
    mockView.options = [seeded, { ...poi, distanceM: 3218.688 }];
    await render(<VenuePickerSheet />);
    expect(await screen.findByText("140 ft")).toBeOnTheScreen();
    expect(screen.getByText("2.0 mi")).toBeOnTheScreen();
    await act(() => setMeasurementUnits("metric"));
    expect(screen.getByText("40 m")).toBeOnTheScreen();
    expect(screen.getByText("3.2 km")).toBeOnTheScreen();
    expect(screen.getByText("Nearest")).toBeOnTheScreen();
    expect(screen.getByText("landmark")).toBeOnTheScreen();
  });

  it("lists nearby museums and confirms the tapped museum", async () => {
    await render(<VenuePickerSheet />);
    expect(screen.getByRole("header", { name: "Choose museum" })).toBeOnTheScreen();
    expect(screen.getByText("40 m")).toBeOnTheScreen();
    expect(screen.getByText("Nearest")).toBeOnTheScreen();
    expect(screen.getByText("310 m")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: seeded.name }));
    expect(mockConfirm).toHaveBeenCalledWith(seeded, expect.any(AbortSignal));
    expect(mockStartVisit).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("confirms another candidate after it is tapped", async () => {
    await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole("button", { name: "Neue Galerie" }));
    expect(mockConfirm).toHaveBeenCalledWith(neighbour, expect.any(AbortSignal));
  });

  it("keeps the no-museum exit available while searching and when nothing matches", async () => {
    const { searchVenues } = jest.requireMock("@/lib/venue/search-venues");
    searchVenues.mockResolvedValue([]);
    await render(<VenuePickerSheet />);
    await fireEvent.changeText(screen.getByLabelText("Search museums"), "Missing museum");
    expect(screen.getByRole("button", { name: "Continue without a museum" })).toBeOnTheScreen();
    expect(await screen.findByText("No museums found.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Continue without a museum" }));
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockDismiss).toHaveBeenCalledTimes(1);
  });

  it("confirms a searched museum by hand for the museum’s current day", async () => {
    jest.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 8, 19, 2, 30));
    const { searchVenues } = jest.requireMock("@/lib/venue/search-venues");
    searchVenues.mockResolvedValue([
      {
        id: "id-met",
        key: "wikidata:Q160236",
        name: "Metropolitan Museum of Art",
        lat: 40.7794,
        lng: -73.9633,
        website: null,
        region: "new-york",
        city: "New York",
        cityKey: "new-york",
        country: "US",
      },
    ]);
    await render(<VenuePickerSheet />);
    await fireEvent.changeText(screen.getByLabelText("Search museums"), "Metropolitan");
    await fireEvent.press(await screen.findByRole("button", { name: "Metropolitan Museum of Art" }));
    expect(mockConfirm).toHaveBeenCalledWith(
      {
        kind: "seeded",
        venueId: "id-met",
        name: "Metropolitan Museum of Art",
        manual: { timeZone: "America/New_York", visitedOn: "2026-09-18" },
      },
      expect.any(AbortSignal),
    );
  });

  it("confirms a lone museum directly without a redundant selection step", async () => {
    mockView = { ...mockView, options: [{ ...seeded, distanceM: 300 }] };
    await render(<VenuePickerSheet />);
    expect(screen.getByRole("header", { name: "Choose museum" })).toBeOnTheScreen();
    expect(screen.getAllByText(seeded.name)).toHaveLength(1);
    expect(screen.getByRole("button", { name: seeded.name })).toBeOnTheScreen();
    expect(screen.getByText("300 m")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: seeded.name }));
    expect(mockConfirm).toHaveBeenCalledWith(mockView.options[0], expect.any(AbortSignal));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("allows retrying a failed single-place confirmation", async () => {
    mockView = { ...mockView, options: [seeded] };
    mockConfirm.mockRejectedValueOnce(new Error("Could not confirm the venue. Try again."));
    await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole("button", { name: seeded.name }));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not confirm the venue. Try again.");
    expect(mockBack).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: seeded.name }));
    expect(mockConfirm).toHaveBeenCalledTimes(2);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("can cancel a pending single-place confirmation without ending a paused visit", async () => {
    mockParams = { mode: "choose" };
    mockView = { ...mockView, visit, options: [seeded] };
    let finish!: () => void;
    mockConfirm.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    await render(<VenuePickerSheet />);
    const confirm = screen.getByRole("button", { name: "Start visit" });
    await fireEvent.press(confirm);
    expect(confirm).toHaveAccessibilityValue({ text: "Starting…" });
    expect(confirm).toBeDisabled();
    await fireEvent.press(screen.getByRole("button", { name: "Not at a museum" }));
    expect(mockConfirm.mock.calls[0][1].aborted).toBe(true);
    expect(mockDismiss).toHaveBeenCalledTimes(1);
    expect(mockEnd).not.toHaveBeenCalled();
    await act(async () => {
      finish();
    });
    expect(mockStartVisit).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("shows a place category for MapKit results and never calls them museums", async () => {
    mockView = { ...mockView, status: "none", options: [poi] };
    const view = await render(<VenuePickerSheet />);
    expect(screen.getByRole("header", { name: "Choose museum" })).toBeOnTheScreen();
    expect(screen.getByText("landmark · Nearest")).toBeOnTheScreen();
    mockView = {
      ...mockView,
      options: [poi, { ...poi, name: "Side Street Studio", distanceM: 1400 }],
    };
    await view.rerender(<VenuePickerSheet />);
    expect(screen.getByRole("header", { name: "Choose museum" })).toBeOnTheScreen();
    expect(screen.getByText("landmark · Nearest")).toBeOnTheScreen();
  });

  it("keeps the sheet open with the reason when confirmation fails", async () => {
    mockConfirm.mockRejectedValue(new Error("rate_limited"));
    await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole("button", { name: seeded.name }));
    expect(screen.getByText("rate_limited")).toBeOnTheScreen();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('dismisses with "Not here" without confirming anything', async () => {
    await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole("button", { name: "Continue without a museum" }));
    expect(mockDismiss).toHaveBeenCalledTimes(1);
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("declines the location prompt when it is swiped away, like the no-museum exit", async () => {
    mockParams = { mode: "choose" };
    const view = await render(<VenuePickerSheet />);
    await view.unmount();
    expect(mockDeclinePrompt).toHaveBeenCalledTimes(1);
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("starts a visit from Start visit on the same map, without taking a swipe away as “Not here”", async () => {
    mockParams = { mode: "start" };
    const view = await render(<VenuePickerSheet />);
    expect(screen.getByRole("radio", { name: seeded.name })).toBeChecked();
    await view.unmount();
    expect(mockDeclinePrompt).not.toHaveBeenCalled();
    mockParams = { mode: "start" };
    await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole("button", { name: "Start visit" }));
    expect(mockStartVisit).toHaveBeenCalledWith("id-met", expect.anything());
  });

  it("declines nothing when the prompt closes after a choice, or a sheet opened by hand is swiped away", async () => {
    mockParams = { mode: "choose" };
    const prompt = await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole("button", { name: "Start visit" }));
    await prompt.unmount();
    mockParams = {};
    const byHand = await render(<VenuePickerSheet />);
    await byHand.unmount();
    expect(mockDeclinePrompt).not.toHaveBeenCalled();
  });

  it("explains an empty result and a denied permission with a way to Settings", async () => {
    mockView = { ...mockView, status: "none", options: [] };
    const view = await render(<VenuePickerSheet />);
    expect(screen.getByText("No nearby museums found.")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Continue without a museum" })).toBeOnTheScreen();
    mockView = { ...mockView, status: "denied", options: [] };
    await view.rerender(<VenuePickerSheet />);
    expect(screen.getByText("Location access is off.")).toBeOnTheScreen();
    const open = jest.spyOn(Linking, "openSettings").mockResolvedValue();
    await fireEvent.press(screen.getByRole("button", { name: "Open Settings" }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("asks for location that was never answered, then looks for nearby museums", async () => {
    mockLocation = { granted: false, canAskAgain: true };
    mockView = { ...mockView, status: "denied", options: [] };
    await render(<VenuePickerSheet />);
    expect(screen.getByText(/^Allow location to find nearby museums\./)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Open Settings" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Allow location" }));
    await waitFor(() => expect(mockResolve).toHaveBeenCalledTimes(1));
  });

  it("allows continuing without a museum while locating", async () => {
    mockView = { ...mockView, status: "locating", options: [] };
    await render(<VenuePickerSheet />);
    expect(screen.getByRole("progressbar", { name: "Locating your museum" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Continue without a museum" })).toBeOnTheScreen();
    expect(screen.queryByText("Finding your museum…")).toBeNull();
  });

  it("marks the confirming row busy without swapping its detail for text", async () => {
    mockConfirm.mockReturnValue(new Promise<void>(() => {}));
    await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole("button", { name: "Metropolitan Museum of Art" }));
    expect(screen.getByRole("button", { name: "Metropolitan Museum of Art" })).toBeBusy();
    expect(screen.queryByText("Confirming…")).toBeNull();
  });

  it.each(["Not here", "swipe"])("cancels a pending confirmation on %s without navigating again", async (method) => {
    let finish!: () => void;
    mockConfirm.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const view = await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole("button", { name: seeded.name }));
    if (method === "Not here") {
      await fireEvent.press(screen.getByRole("button", { name: "Continue without a museum" }));
    }
    await view.unmount();
    const [, signal] = mockConfirm.mock.calls[0];
    expect(signal.aborted).toBe(true);
    await act(async () => {
      finish();
    });
    expect(mockBack).toHaveBeenCalledTimes(method === "Not here" ? 1 : 0);
  });
});

describe("the open visit", () => {
  beforeEach(() => {
    mockView = {
      ...mockView,
      status: "resolved",
      venue: seeded,
      visit,
      options: [seeded, neighbour],
    };
  });

  it('changes the museum from the visit screen, and "Keep current visit" closes the sheet', async () => {
    mockParams = { mode: "change" };
    await render(<VenuePickerSheet />);
    expect(screen.getByRole("header", { name: "Choose museum" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Continue without a museum" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Keep current visit" }));
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockDismiss).not.toHaveBeenCalled();
    expect(mockEnd).not.toHaveBeenCalled();
  });

  it("offers to keep the current visit when changing the museum finds nothing nearby", async () => {
    mockParams = { mode: "change" };
    mockView = { ...mockView, status: "none", options: [] };
    await render(<VenuePickerSheet />);
    expect(screen.getByText("No nearby museums found.")).toBeOnTheScreen();
    expect(screen.getByText("Search by museum or city, or keep your current visit.")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Continue without a museum" })).toBeNull();
    expect(screen.getByRole("button", { name: "Keep current visit" })).toBeOnTheScreen();
  });

  it("confirms a different museum chosen while changing it", async () => {
    mockParams = { mode: "change" };
    await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole("button", { name: "Neue Galerie" }));
    expect(mockConfirm).toHaveBeenCalledWith(neighbour, expect.any(AbortSignal));
    expect(mockStartVisit).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("shows the chooser for a paused visit when location is denied", async () => {
    mockView = { ...mockView, status: "denied", venue: undefined, options: [] };
    await render(<VenuePickerSheet />);
    expect(screen.getByText("Location access is off.")).toBeOnTheScreen();
  });

  it("offers the resolved museum, not the visit paused at another one, when the pill opens the sheet", async () => {
    mockView = { ...mockView, venue: neighbour, options: [neighbour] };
    await render(<VenuePickerSheet />);
    expect(screen.getByRole("header", { name: "Choose museum" })).toBeOnTheScreen();
    expect(screen.getByText("Neue Galerie")).toBeOnTheScreen();
    expect(screen.queryByText(/^Since /)).toBeNull();
    expect(screen.queryByRole("button", { name: "End visit" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Continue without a museum" }));
    expect(mockDismiss).toHaveBeenCalledTimes(1);
    expect(mockEnd).not.toHaveBeenCalled();
  });

  describe("a prompt while the visit is paused elsewhere", () => {
    beforeEach(() => {
      mockParams = { mode: "choose" };
      mockView = {
        ...mockView,
        status: "choose",
        venue: undefined,
        options: [
          {
            ...seeded,
            venueId: "id-guggenheim" as never,
            name: "Guggenheim",
            distanceM: 120,
          },
          neighbour,
        ],
      };
    });

    it("says starting one ends the paused visit and requests a single replacement", async () => {
      await render(<VenuePickerSheet />);
      expect(
        screen.getByText(
          "More than one museum is within a short walk. Your visit to Metropolitan Museum of Art ends when a new one starts.",
        ),
      ).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole("button", { name: "Start visit" }));
      expect(mockEnd).not.toHaveBeenCalled();
      expect(mockStartVisit).toHaveBeenCalledWith("id-guggenheim", {
        signal: expect.any(AbortSignal),
        replaceVisitLocalId: "visit-1",
      });
      expect(mockBack).toHaveBeenCalledTimes(1);
    });

    it('lists the candidates, and "Not here" dismisses without ending it', async () => {
      await render(<VenuePickerSheet />);
      expect(screen.getByRole("header", { name: "Start a visit?" })).toBeOnTheScreen();
      expect(screen.getByRole("radio", { name: "Guggenheim" })).toBeChecked();
      expect(screen.queryByRole("button", { name: "Keep current visit" })).toBeNull();
      await fireEvent.press(screen.getByRole("button", { name: "Not at a museum" }));
      expect(mockDismiss).toHaveBeenCalledTimes(1);
      expect(mockEnd).not.toHaveBeenCalled();
      expect(mockBack).toHaveBeenCalledTimes(1);
    });
  });
});

describe("recovering or cancelling a prompted visit start", () => {
  beforeEach(() => {
    mockParams = { mode: "choose" };
  });

  it.each(["decline", "swipe"])("cancels a pending visit start on %s", async (action) => {
    let fail!: (error: Error) => void;
    mockStartVisit.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    const ui = await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole("button", { name: "Start visit" }));
    const signal = mockStartVisit.mock.calls[0][1]?.signal;
    if (action === "decline") await fireEvent.press(screen.getByRole("button", { name: "Not at a museum" }));
    else await ui.unmount();
    await act(async () => {
      fail(Object.assign(new Error("Cancelled"), { name: "AbortError" }));
    });
    expect(signal?.aborted).toBe(true);
    expect(mockToast).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(action === "decline" ? 1 : 0);
  });

  it("keeps a confirmed MapKit museum selected so a failed visit start can be retried", async () => {
    mockView = { ...mockView, options: [poi] };
    const { initialVenueState, venueReducer } = jest.requireActual("@/lib/venue/venue-reducer");
    mockConfirm.mockImplementation(async (option: VenueOption) => {
      const selected = { kind: "seeded", venueId: "id-confirmed-place", name: option.name };
      mockView = {
        ...mockView,
        ...venueReducer(
          { ...initialVenueState, ...mockView },
          {
            type: "chosen",
            option: selected,
            replaces: option,
            day: { visitedOn: "2026-10-04", timeZone: "UTC" },
          },
        ),
      };
      return selected.venueId;
    });
    mockStartVisit.mockRejectedValueOnce(new Error("storage failure"));
    const ui = await render(<VenuePickerSheet />);
    await fireEvent.press(screen.getByRole("button", { name: "Start visit" }));
    await ui.rerender(<VenuePickerSheet />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t start the visit. Try again.");
    expect(screen.getByRole("radio", { name: poi.name })).toBeChecked();
    expect(screen.getByRole("button", { name: "Start visit" })).not.toBeDisabled();
    await fireEvent.press(screen.getByRole("button", { name: "Start visit" }));
    expect(mockToast).toHaveBeenCalledWith("Visit started.");
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
