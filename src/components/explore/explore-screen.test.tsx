import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";
import type { ReactNode } from "react";
import { AppState, Linking } from "react-native";

import { chooseCity } from "@/lib/explore/use-explore";
import { offerNotifications } from "@/lib/notifications/offer";
import * as toast from "@/lib/ui/toast";

import { bayArea, regions } from "./__fixtures__/catalog";
import { ExhibitionListScreen } from "./exhibition-list-screen";
import { ExhibitionScreen } from "./exhibition-screen";
import { ExploreScreen } from "./explore-screen";
import { MuseumScreen } from "./museum-screen";
import { WantToSeeScreen } from "./want-to-see-screen";

const mockPush = jest.fn();
const mockRefresh = jest.fn();
const mockSavedRefresh = jest.fn();
const mockOpenBrowser = jest.fn(async (_url: string) => undefined);
const mockRequestRegion = jest.fn(async (_args: { region: string }) => null);
const mockSetWantToSee = jest.fn(async (_args: { exhibitionId: string; saved: boolean }) => null);
let mockSaved: string[] | Error | undefined;
let mockFriendSaves: unknown[];
let mockOwner: string;
let mockServerScope: string | undefined;
let mockExhibitionReminders: boolean;
let mockParams: { timing?: string } = {};
let mockFix: { lat: number; lng: number } | undefined;
let mockOffline = false;
let mockFailure: Error | undefined;
let mockRegions: unknown[];
let mockHome: string | undefined;
let mockVenueStatus: string;
let mockPermission: { granted: boolean; canAskAgain: boolean } | null;
const mockRequestPermission = jest.fn(async () => ({ granted: true, canAskAgain: true }));
const mockResolve = jest.fn(async (_options?: { quiet?: boolean }) => ({}));
let mockCached: Map<string, unknown>;

jest.mock("expo-router", () => {
  const { mockStack } = jest.requireActual("@/components/stack-toolbar-mock");
  return {
    router: { push: (...args: unknown[]) => mockPush(...args) },
    useRouter: () => ({ push: mockPush }),
    useLocalSearchParams: () => mockParams,
    useNavigation: () => ({ setOptions: jest.fn() }),
    Stack: mockStack,
  };
});
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 116 }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: (url: string) => mockOpenBrowser(url) }));
jest.mock("expo-network", () => ({ useNetworkState: () => ({ isInternetReachable: !mockOffline }) }));
jest.mock("@/lib/venue/use-venue", () => ({
  useVenue: () => ({ fix: mockFix, status: mockVenueStatus, resolve: mockResolve }),
}));
jest.mock("expo-location", () => {
  const { createPermissionHook } = jest.requireActual("expo-modules-core");
  return {
    useForegroundPermissions: createPermissionHook({
      getMethod: async () => mockPermission,
      requestMethod: () => mockRequestPermission(),
    }),
  };
});
jest.mock("@/lib/venue/venue-db", () => ({ regionAt: async () => mockHome }));
jest.mock("@/lib/settings/use-measurement-units", () => ({
  useMeasurementUnits: () => ({ units: "imperial", failed: false }),
}));
jest.mock("@/lib/social/use-query-refresh", () => ({
  useQueryBatchRefresh: (query: unknown) => ({
    refreshing: false,
    refresh:
      jest.requireActual("convex/server").getFunctionName(query) === "wantToSee:mine" ? mockSavedRefresh : mockRefresh,
  }),
}));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));
jest.mock("@/lib/use-device-ready", () => ({ useDeviceReady: () => true }));
jest.mock("@/lib/account/owner-store", () => ({
  useLocalOwner: () => mockOwner,
  useServerScope: () => mockServerScope,
}));
jest.mock("@/lib/notifications/preferences", () => ({
  getNotificationPreferences: async () => ({ exhibitionReminders: mockExhibitionReminders }),
}));
jest.mock("@/lib/notifications/offer", () => ({
  ...jest.requireActual("@/lib/notifications/offer"),
  offerNotifications: jest.fn(),
}));
jest.mock("convex/react", () => ({
  useMutation: (mutation: unknown) =>
    jest.requireActual("convex/server").getFunctionName(mutation) === "wantToSee:set"
      ? { withOptimisticUpdate: () => mockSetWantToSee }
      : mockRequestRegion,
  useQueries: (
    requests: Record<
      string,
      { query: unknown; args: { region?: string; museumId?: string; exhibitionIds?: string[] } }
    >,
  ) => {
    const { getFunctionName } = jest.requireActual("convex/server");
    const { bayArea, cornwall, london } = jest.requireActual("./__fixtures__/catalog");
    return Object.fromEntries(
      Object.entries(requests).map(([key, { query, args }]) => {
        if (mockOffline) return [key, mockCached.get(key)];
        if (mockFailure) return [key, mockFailure];
        const name = getFunctionName(query);
        if (args.exhibitionIds && args.exhibitionIds.length > 100) return [key, new Error("batch_too_large")];
        let data;
        if (name === "exhibitions:regions") {
          data = mockRegions;
        } else if (name === "wantToSee:mine") {
          data = mockSaved;
        } else if (name === "wantToSee:friends") {
          data = mockFriendSaves;
        } else if (name === "exhibitions:inRegion") {
          data = args.region === "london" ? london : args.region === "country:GB" ? cornwall : bayArea;
        } else {
          const exhibitions = [...bayArea.exhibitions, ...cornwall.exhibitions].filter((show) =>
            args.museumId ? show.museumId === args.museumId : args.exhibitionIds?.includes(show.exhibitionId),
          );
          const museums = [...bayArea.museums, ...cornwall.museums].filter(
            (museum) =>
              museum.museumId === args.museumId || exhibitions.some((show) => show.museumId === museum.museumId),
          );
          data = { exhibitions, museums };
        }
        mockCached.set(key, data);
        return [key, data];
      }),
    );
  },
}));
// The heading menu draws its label as the trigger; the shared mock's Menu drops it.
jest.mock("@expo/ui/swift-ui", () => {
  const { View } = jest.requireActual("react-native");
  return {
    ...jest.requireActual("@/__mocks__/@expo/ui/swift-ui"),
    Menu: ({ label, children }: { label: ReactNode; children: ReactNode }) => (
      <View>
        {label}
        {children}
      </View>
    ),
  };
});

const permission = (status: number) => ({ status: "", granted: status === 2, ios: { status } }) as never;
const orchard = bayArea.exhibitions.find((show) => show.exhibitionId === "orchard")!.viewingPeriods[0];
const tides = bayArea.exhibitions.find((show) => show.exhibitionId === "tides")!.viewingPeriods[0];
/** 9 AM on a fixture date, `back` days earlier, as a reminder names it. */
function reminderDay(date: string, back = 0, options: Intl.DateTimeFormatOptions = { weekday: "long" }) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { ...options, month: "short", day: "numeric" }).format(
    new Date(year, month - 1, day - back, 9),
  );
}

const card = (title: string) => screen.queryByRole("button", { name: new RegExp(`^${title}, .*(Museum|Tate)`) });

beforeEach(() => {
  mockPush.mockClear();
  mockRefresh.mockClear();
  mockSavedRefresh.mockClear();
  mockOpenBrowser.mockClear();
  mockRequestRegion.mockClear();
  mockSetWantToSee.mockClear();
  jest.mocked(offerNotifications).mockClear();
  mockSaved = [];
  mockFriendSaves = [];
  mockOwner = "device:test";
  mockServerScope = "device:test:0";
  mockExhibitionReminders = true;
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission(0));
  mockParams = {};
  mockFix = undefined;
  mockOffline = false;
  mockFailure = undefined;
  mockRegions = regions;
  mockHome = undefined;
  mockVenueStatus = "resolved";
  mockPermission = { granted: true, canAskAgain: true };
  mockRequestPermission.mockClear();
  mockResolve.mockClear();
  mockCached = new Map();
  chooseCity(undefined);
});

afterEach(() => jest.restoreAllMocks());

describe("Explore", () => {
  // A city picked from the menu holds for the app session, so this picks the one the other tests open on.
  it("opens on the city nearest the phone, then the one picked from the city menu", async () => {
    mockFix = { lat: 50.21, lng: -5.48 };
    await render(<ExploreScreen />);
    expect(screen.getByLabelText("City, United Kingdom")).toBeOnTheScreen();
    expect(card("Harbour Drawings")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "San Francisco Bay Area" }));

    expect(screen.getByLabelText("City, San Francisco Bay Area")).toBeOnTheScreen();
    expect(card("Tides of Memory")).toBeOnTheScreen();
    expect(card("Harbour Drawings")).toBeNull();
  });

  it("switches only the exhibitions row from its heading menu", async () => {
    await render(<ExploreScreen />);
    expect(card("Tides of Memory")).toBeOnTheScreen();
    expect(card("Fog Studies")).toBeOnTheScreen();
    expect(card("Orchard Light")).toBeNull();

    await fireEvent.press(screen.getByRole("checkbox", { name: "Opening soon" }));

    expect(screen.getByText("Opening soon")).toBeOnTheScreen();
    expect(card("Orchard Light")).toBeOnTheScreen();
    expect(card("The Returning Room")).toBeOnTheScreen();
    expect(card("Tides of Memory")).toBeNull();
    // The museums keep their content.
    expect(
      screen.getByRole("button", { name: "Oakland Museum of California, 1 exhibition, 1 ending soon" }),
    ).toBeOnTheScreen();
  });

  it("lists the museums nearest the phone first, with their distance", async () => {
    await render(<ExploreScreen />);
    expect(screen.getByRole("header", { name: "Museums" })).toBeOnTheScreen();

    mockFix = { lat: 37.870804, lng: -122.26634 };
    mockHome = "sf-bay-area";
    await render(<ExploreScreen />);

    expect(await screen.findByRole("header", { name: "Museums near you" })).toBeOnTheScreen();
    const museums = screen.getAllByRole("button", { name: / exhibitions?(,|$)/ });
    expect(museums[0]).toHaveAccessibleName(
      "Berkeley Art Museum and Pacific Film Archive, 10 ft · Berkeley, 2 exhibitions",
    );
    expect(museums[1]).toHaveAccessibleName(/^Oakland Museum of California, 5\.0 mi, 1 exhibition/);
  });

  it("opens the full list with the row's choice", async () => {
    await render(<ExploreScreen />);
    await fireEvent.press(screen.getByRole("checkbox", { name: "Just opened" }));
    await fireEvent.press(screen.getByRole("button", { name: "See all: Just opened" }));

    expect(mockPush).toHaveBeenCalledWith({ pathname: "/exhibitions", params: { timing: "opened" } });
  });

  it("opens the map, Want to see and a show from the page", async () => {
    await render(<ExploreScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Map" }));
    await fireEvent.press(screen.getByRole("button", { name: "Want to see" }));
    await fireEvent.press(card("Tides of Memory")!);

    expect(mockPush.mock.calls).toEqual([
      ["/explore-map"],
      ["/want-to-see"],
      [{ pathname: "/exhibition/[exhibitionId]", params: { exhibitionId: "tides" } }],
    ]);
  });

  it("explains an offline phone, a failed load and a catalog with no shows", async () => {
    mockOffline = true;
    await render(<ExploreScreen />);
    expect(screen.getByText("You’re offline.")).toBeOnTheScreen();

    mockOffline = false;
    mockFailure = new Error("Network request failed");
    await render(<ExploreScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(mockRefresh).toHaveBeenCalled();

    mockFailure = undefined;
    mockRegions = [];
    await render(<ExploreScreen />);
    expect(screen.getByText("No exhibitions listed yet.")).toBeOnTheScreen();
  });

  it("asks the backend to keep the shown city's museum listings current, never while offline", async () => {
    mockFix = { lat: 50.21, lng: -5.48 };
    await render(<ExploreScreen />);
    expect(mockRequestRegion).toHaveBeenLastCalledWith({ region: "country:GB" });

    await fireEvent.press(screen.getByRole("button", { name: "San Francisco Bay Area" }));
    expect(mockRequestRegion).toHaveBeenLastCalledWith({ region: "sf-bay-area" });

    mockRequestRegion.mockClear();
    mockOffline = true;
    await render(<ExploreScreen />);
    expect(mockRequestRegion).not.toHaveBeenCalled();
  });

  it("keeps the loaded catalog visible when the connection drops", async () => {
    const view = await render(<ExploreScreen />);
    expect(card("Tides of Memory")).toBeOnTheScreen();
    mockOffline = true;
    await view.rerender(<ExploreScreen />);
    expect(card("Tides of Memory")).toBeOnTheScreen();
    expect(screen.queryByText("You’re offline.")).toBeNull();
  });

  it("opens the nearest city with shows when none are listed where the phone is, and says so", async () => {
    mockFix = { lat: 48.86, lng: 2.34 };
    mockHome = "paris";
    await render(<ExploreScreen />);

    expect(await screen.findByLabelText("City, United Kingdom")).toBeOnTheScreen();
    expect(screen.getByText("Nothing listed in Paris yet. Showing United Kingdom, 363 mi away.")).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Museums" })).toBeOnTheScreen();
    // The phone's own region keeps its listings on schedule even though Explore shows another.
    expect(mockRequestRegion.mock.calls).toEqual(
      expect.arrayContaining([[{ region: "country:GB" }], [{ region: "paris" }]]),
    );

    await fireEvent.press(screen.getByRole("button", { name: "San Francisco Bay Area" }));
    expect(screen.getByLabelText("City, San Francisco Bay Area")).toBeOnTheScreen();
    expect(screen.queryByText(/^Nothing listed in Paris/)).toBeNull();
  });

  it("follows the phone from the top of the city menu, naming its area, until a city is picked", async () => {
    mockFix = { lat: 37.870804, lng: -122.26634 };
    mockHome = "sf-bay-area";
    await render(<ExploreScreen />);
    const myLocation = await screen.findByRole("button", { name: "My Location" });
    expect(myLocation).toBeSelected();
    expect(screen.getByHintText("San Francisco Bay Area")).toBe(myLocation);
    expect(screen.getByRole("button", { name: "San Francisco Bay Area" })).not.toBeSelected();

    await fireEvent.press(screen.getByRole("button", { name: "United Kingdom" }));
    expect(screen.getByLabelText("City, United Kingdom")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "United Kingdom" })).toBeSelected();
    expect(screen.getByRole("button", { name: "My Location" })).not.toBeSelected();

    await fireEvent.press(screen.getByRole("button", { name: "My Location" }));
    expect(screen.getByLabelText("City, San Francisco Bay Area")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "My Location" })).toBeSelected();
  });

  it.each(["denied", "resolved"])("asks for location even when the museum status is %s", async (status) => {
    mockVenueStatus = status;
    mockPermission = { granted: false, canAskAgain: true };
    await render(<ExploreScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "United Kingdom" }));
    const useMyLocation = screen.getByRole("button", { name: "Use My Location" });
    expect(screen.queryByHintText("Turn on in Settings")).toBeNull();

    await fireEvent.press(useMyLocation);

    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockResolve).toHaveBeenCalledWith({ quiet: true }));
    // The pick is cleared, so the city follows the fix the resolve brings.
    expect(screen.getByLabelText("City, San Francisco Bay Area")).toBeOnTheScreen();
  });

  it("follows the phone after location is enabled in Settings", async () => {
    const appState = jest.spyOn(AppState, "addEventListener");
    const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    mockVenueStatus = "denied";
    mockPermission = { granted: false, canAskAgain: false };
    await render(<ExploreScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "United Kingdom" }));
    const useMyLocation = screen.getByHintText("Turn on in Settings");
    expect(useMyLocation).toHaveAccessibleName("Use My Location");

    await fireEvent.press(useMyLocation);

    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(mockRequestPermission).not.toHaveBeenCalled();

    mockPermission = { granted: true, canAskAgain: true };
    mockVenueStatus = "resolved";
    mockFix = { lat: 37.870804, lng: -122.26634 };
    mockHome = "sf-bay-area";
    await act(async () => {
      for (const [event, listener] of appState.mock.calls) if (event === "change") listener("active");
    });
    expect(await screen.findByLabelText("City, San Francisco Bay Area")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "My Location" })).toBeSelected();
  });

  it("keeps the chosen city when the location prompt is declined", async () => {
    mockPermission = { granted: false, canAskAgain: true };
    mockRequestPermission.mockResolvedValueOnce({ granted: false, canAskAgain: false });
    await render(<ExploreScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "United Kingdom" }));
    await fireEvent.press(screen.getByRole("button", { name: "Use My Location" }));

    expect(screen.getByLabelText("City, United Kingdom")).toBeOnTheScreen();
    expect(screen.getByHintText("Turn on in Settings")).toBeOnTheScreen();
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("opens a city where nothing ends soon on what is on view", async () => {
    mockRegions = [...regions, { region: "london", lat: 51.5, lng: -0.12 }];
    await render(<ExploreScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "London" }));

    expect(screen.getByText("On now")).toBeOnTheScreen();
    expect(card("River Rooms")).toBeOnTheScreen();
    expect(card("Undated Collection")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("checkbox", { name: "Ending soon" }));
    expect(screen.getByText("No exhibitions close in the next 30 days.")).toBeOnTheScreen();
  });
});

describe("Exhibitions list", () => {
  it("starts on the timing Explore passed and switches with its menu", async () => {
    mockParams = { timing: "upcoming" };
    await render(<ExhibitionListScreen />);
    expect(screen.getByRole("button", { name: /^Orchard Light, Opens/ })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /^Tides of Memory/ })).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Ending soon" }));

    expect(screen.getByRole("button", { name: /^Tides of Memory, Ends in 8 days/ })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /^Orchard Light/ })).toBeNull();
  });
});

describe("Exhibition", () => {
  it("resolves a nonlocal detail and keeps it visible through location and city changes", async () => {
    const view = await render(<ExhibitionScreen exhibitionId="harbour" />);
    expect(screen.getByRole("header", { name: "Harbour Drawings" })).toBeOnTheScreen();
    mockFix = { lat: 37.78, lng: -122.4 };
    await act(() => chooseCity("sf-bay-area"));
    await view.rerender(<ExhibitionScreen exhibitionId="harbour" />);
    expect(screen.getByRole("header", { name: "Harbour Drawings" })).toBeOnTheScreen();
    mockOffline = true;
    await view.rerender(<ExhibitionScreen exhibitionId="harbour" />);
    expect(screen.getByRole("header", { name: "Harbour Drawings" })).toBeOnTheScreen();
  });

  it("still opens a show that has closed, saying when it closed", async () => {
    await render(<ExhibitionScreen exhibitionId="ended" />);
    expect(screen.getByRole("header", { name: "Last Light" })).toBeOnTheScreen();
    expect(screen.getByText(/^Closed [A-Z][a-z]{2} \d{1,2}$/)).toBeOnTheScreen();
  });

  it("gives the dates the museum lists and opens its page for the show", async () => {
    await render(<ExhibitionScreen exhibitionId="collection" />);
    expect(screen.getByRole("header", { name: "Collection in Focus" })).toBeOnTheScreen();
    expect(screen.getByText(/^Through [A-Z][a-z]{2} \d{1,2}, \d{4}$/)).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("link", { name: "Details on sfmoma.org" }));

    expect(mockOpenBrowser).toHaveBeenCalledWith("https://www.sfmoma.org/exhibitions/collection");
  });
});

it("opens a museum outside the browsing city and keeps its shows through location changes", async () => {
  const view = await render(<MuseumScreen museumId="tate" />);
  expect(screen.getByRole("header", { name: "Tate St Ives" })).toBeOnTheScreen();
  mockFix = { lat: 37.78, lng: -122.4 };
  await view.rerender(<MuseumScreen museumId="tate" />);
  expect(screen.getByRole("header", { name: "Tate St Ives" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: /^Harbour Drawings/ })).toBeOnTheScreen();
});

describe("Want to see", () => {
  it("disables saving during the guest merge and resumes once the account is ready", async () => {
    mockSaved = ["tides"];
    const view = await render(<ExploreScreen />);
    expect(screen.getByRole("button", { name: "Remove Tides of Memory from Want to see" })).toBeEnabled();

    mockServerScope = undefined;
    await view.rerender(<ExploreScreen />);
    const saving = screen.getByRole("button", { name: "Want to see Tides of Memory" });
    expect(saving).toBeDisabled();
    await fireEvent.press(saving);
    expect(mockSetWantToSee).not.toHaveBeenCalled();
    await view.rerender(<ExhibitionScreen exhibitionId="tides" />);
    expect(screen.getByRole("button", { name: "Want to see" })).toBeDisabled();
    await view.rerender(<WantToSeeScreen />);
    expect(screen.getByRole("progressbar", { name: "Loading exhibitions…" })).toBeOnTheScreen();
    expect(screen.queryByText("Nothing saved yet.")).toBeNull();

    mockOwner = "account:test";
    mockServerScope = "account:test:1";
    await view.rerender(<WantToSeeScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Remove Tides of Memory from Want to see" }));
    expect(mockSetWantToSee).toHaveBeenCalledWith({ exhibitionId: "tides", saved: false });
  });

  it("disables save controls until their saved state is known", async () => {
    mockSaved = undefined;
    const view = await render(<ExploreScreen />);
    expect(screen.getByRole("button", { name: "Want to see Tides of Memory" })).toBeDisabled();
    await view.rerender(<ExhibitionScreen exhibitionId="tides" />);
    expect(screen.getByRole("button", { name: "Want to see" })).toBeDisabled();
    expect(mockSetWantToSee).not.toHaveBeenCalled();
  });

  it("waits for saved IDs before showing an empty list", async () => {
    mockSaved = undefined;
    const view = await render(<WantToSeeScreen />);
    expect(screen.getByRole("progressbar", { name: "Loading exhibitions…" })).toBeOnTheScreen();
    expect(screen.queryByText("Nothing saved yet.")).toBeNull();

    mockSaved = ["collection"];
    await view.rerender(<WantToSeeScreen />);
    expect(screen.getByRole("button", { name: /^Collection in Focus, Until/ })).toBeOnTheScreen();
  });

  it("offers a retry for a failed saved-list query", async () => {
    mockSaved = new Error("Saved list failed");
    const view = await render(<WantToSeeScreen />);
    expect(screen.getByText("Couldn’t load exhibitions.")).toBeOnTheScreen();
    expect(screen.queryByText("Nothing saved yet.")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(mockSavedRefresh).toHaveBeenCalledTimes(1);
    expect(mockRefresh).not.toHaveBeenCalled();

    mockSaved = [];
    await view.rerender(<WantToSeeScreen />);
    expect(screen.getByText("Nothing saved yet.")).toBeOnTheScreen();
  });

  it("shows the offline state when saved IDs cannot load", async () => {
    mockOffline = true;
    await render(<WantToSeeScreen />);
    expect(screen.getByText("You’re offline.")).toBeOnTheScreen();
    expect(screen.queryByText("Nothing saved yet.")).toBeNull();
  });

  it("shows saved exhibitions beyond the backend's per-query limit", async () => {
    mockSaved = [...Array.from({ length: 100 }, (_, index) => `removed-${index}`), "harbour"];
    await render(<WantToSeeScreen />);
    expect(screen.getByRole("button", { name: /^Harbour Drawings, Ends/ })).toBeOnTheScreen();
  });

  it("keeps saved shows from multiple cities after changing the browse city", async () => {
    mockSaved = ["tides", "harbour"];
    await render(<WantToSeeScreen />);
    expect(screen.getByRole("button", { name: /^Tides of Memory, Ends/ })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: /^Harbour Drawings, Ends/ })).toBeOnTheScreen();
    await act(() => chooseCity("country:GB"));
    expect(screen.getByRole("button", { name: /^Tides of Memory, Ends/ })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: /^Harbour Drawings, Ends/ })).toBeOnTheScreen();
  });

  it("keeps closed shows under their own heading after the rest", async () => {
    mockSaved = ["ended", "tides"];
    await render(<WantToSeeScreen />);
    expect(screen.getByRole("header", { name: "Closed" })).toBeOnTheScreen();
    const rows = screen.getAllByRole("button", { name: /^(Tides of Memory|Last Light), / });
    expect(rows[0]).toHaveAccessibleName(/^Tides of Memory, Ends/);
    expect(rows[1]).toHaveAccessibleName(/^Last Light, Closed [A-Z][a-z]{2} \d{1,2}, Oakland Museum of California$/);
    expect(screen.getByRole("button", { name: "Remove Last Light from Want to see" })).toBeOnTheScreen();
  });

  it("lists saved shows until they are removed", async () => {
    const view = await render(<WantToSeeScreen />);
    expect(screen.getByText("Nothing saved yet.")).toBeOnTheScreen();

    mockSaved = ["collection"];
    await view.rerender(<WantToSeeScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Remove Collection in Focus from Want to see" }));
    expect(mockSetWantToSee).toHaveBeenCalledWith({ exhibitionId: "collection", saved: false });

    mockSaved = [];
    await view.rerender(<WantToSeeScreen />);
    expect(screen.getByText("Nothing saved yet.")).toBeOnTheScreen();
  });

  it("says when a saved show's first reminder comes", async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission(2));
    const showToast = jest.spyOn(toast, "showToast");
    await render(<ExploreScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Want to see Tides of Memory" }));
    await waitFor(() =>
      expect(showToast).toHaveBeenLastCalledWith(
        `Saved. You’ll get a reminder ${reminderDay(tides.endDate, 7)}, a week before it closes.`,
      ),
    );

    await fireEvent.press(screen.getByRole("checkbox", { name: "Opening soon" }));
    await fireEvent.press(screen.getByRole("button", { name: "Want to see Orchard Light" }));
    await waitFor(() =>
      expect(showToast).toHaveBeenLastCalledWith(
        `Saved. You’ll get a reminder ${reminderDay(orchard.startDate!)}, when it opens.`,
      ),
    );
    expect(offerNotifications).not.toHaveBeenCalled();
  });

  it("waits for the save to succeed before promising a reminder", async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission(2));
    let finish!: (value: null) => void;
    mockSetWantToSee.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const showToast = jest.spyOn(toast, "showToast");
    await render(<ExploreScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Want to see Tides of Memory" }));
    await act(async () => {});
    expect(showToast).not.toHaveBeenCalled();

    await act(() => finish(null));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/^Saved\./)));
  });

  it.each([0, 2])("keeps a failed save's retry instead of confirming it with permission %s", async (status) => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission(status));
    mockSetWantToSee.mockRejectedValueOnce(new Error("Save failed"));
    const showToast = jest.spyOn(toast, "showToast");
    const showErrorToast = jest.spyOn(toast, "showErrorToast");
    await render(<ExploreScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Want to see Tides of Memory" }));
    await act(async () => {});

    expect(showErrorToast).toHaveBeenCalledWith("Couldn’t update Want to see.", expect.any(Function));
    expect(showToast).not.toHaveBeenCalled();
    expect(offerNotifications).not.toHaveBeenCalled();
    await act(() => showErrorToast.mock.lastCall![1]!());
    expect(mockSetWantToSee).toHaveBeenCalledTimes(2);
  });

  it.each([0, 1, 2])("respects the reminder opt-out with system permission %s", async (status) => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission(status));
    mockExhibitionReminders = false;
    const showToast = jest.spyOn(toast, "showToast");
    await render(<ExploreScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Want to see Tides of Memory" }));
    expect(mockSetWantToSee).toHaveBeenLastCalledWith({ exhibitionId: "tides", saved: true });
    await act(async () => {});
    expect(showToast).not.toHaveBeenCalled();
    expect(offerNotifications).not.toHaveBeenCalled();
  });

  it("points a save to Settings when notifications are off", async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission(1));
    const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue();
    const showToast = jest.spyOn(toast, "showToast");
    await render(<ExploreScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Want to see Tides of Memory" }));
    await waitFor(() =>
      expect(showToast).toHaveBeenLastCalledWith("Saved. Turn on notifications to get reminders.", expect.anything()),
    );
    showToast.mock.lastCall![1]!.onPress();
    expect(openSettings).toHaveBeenCalled();
  });

  it("saves any show from its card, offering notifications for its reminders", async () => {
    await render(<ExploreScreen />);
    await fireEvent.press(screen.getByRole("checkbox", { name: "Opening soon" }));
    await fireEvent.press(screen.getByRole("button", { name: "Want to see Orchard Light" }));
    expect(mockSetWantToSee).toHaveBeenLastCalledWith({ exhibitionId: "orchard", saved: true });
    expect(offerNotifications).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /^Remind me/ })).toBeNull();
  });

  it("shows which friends want to see a show once signed in", async () => {
    mockFriendSaves = [
      { exhibitionId: "tides", friend: { profileId: "maya", name: "Maya", avatar: "vermeer" }, savedAt: 2 },
      { exhibitionId: "tides", friend: { profileId: "sam", name: "Sam", avatar: "vermeer" }, savedAt: 1 },
    ];
    await render(<ExploreScreen />);
    expect(screen.queryByRole("header", { name: "Friends want to see" })).toBeNull();

    mockOwner = "account:test";
    await render(<ExploreScreen />);
    expect(screen.getByRole("header", { name: "Friends want to see" })).toBeOnTheScreen();
    expect(card("Tides of Memory")).toHaveAccessibleName(/Maya and Sam want to see it$/);
  });
});
