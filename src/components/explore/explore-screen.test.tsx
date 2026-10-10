import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { toggleWantToSee } from "@/lib/explore/plans";
import { chooseCity } from "@/lib/explore/use-explore";

import { regions } from "./__fixtures__/catalog";
import { ExhibitionListScreen } from "./exhibition-list-screen";
import { ExhibitionScreen } from "./exhibition-screen";
import { ExploreScreen } from "./explore-screen";
import { MuseumScreen } from "./museum-screen";
import { WantToSeeScreen } from "./want-to-see-screen";

const mockPush = jest.fn();
const mockRefresh = jest.fn();
const mockOpenBrowser = jest.fn(async (_url: string) => undefined);
const mockRequestRegion = jest.fn(async (_args: { region: string }) => null);
let mockParams: { timing?: string } = {};
let mockFix: { lat: number; lng: number } | undefined;
let mockOffline = false;
let mockFailure: Error | undefined;
let mockRegions: unknown[];
let mockEmptyRegion: string | undefined;
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
jest.mock("@/lib/venue/use-venue", () => ({ useVenue: () => ({ fix: mockFix }) }));
jest.mock("@/lib/settings/use-measurement-units", () => ({
  useMeasurementUnits: () => ({ units: "imperial", failed: false }),
}));
jest.mock("@/lib/social/use-query-refresh", () => ({
  useQueryBatchRefresh: () => ({ refreshing: false, refresh: mockRefresh }),
}));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));
jest.mock("@/lib/use-device-ready", () => ({ useDeviceReady: () => true }));
jest.mock("convex/react", () => ({
  useMutation: () => mockRequestRegion,
  useQueries: (
    requests: Record<
      string,
      { query: unknown; args: { region?: string; museumId?: string; exhibitionIds?: string[] } }
    >,
  ) => {
    const { getFunctionName } = jest.requireActual("convex/server");
    const { bayArea, cornwall } = jest.requireActual("./__fixtures__/catalog");
    return Object.fromEntries(
      Object.entries(requests).map(([key, { query, args }]) => {
        if (mockOffline) return [key, mockCached.get(key)];
        if (mockFailure) return [key, mockFailure];
        const name = getFunctionName(query);
        if (args.exhibitionIds && args.exhibitionIds.length > 100) return [key, new Error("batch_too_large")];
        let data;
        if (name === "exhibitions:regions") {
          data = mockRegions;
        } else if (name === "exhibitions:inRegion") {
          data =
            args.region === mockEmptyRegion
              ? { museums: [], exhibitions: [] }
              : args.region === "country:GB"
                ? cornwall
                : bayArea;
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

const card = (title: string) => screen.queryByRole("button", { name: new RegExp(`^${title}, .*(Museum|Tate)`) });

beforeEach(() => {
  mockPush.mockClear();
  mockRefresh.mockClear();
  mockOpenBrowser.mockClear();
  mockRequestRegion.mockClear();
  mockParams = {};
  mockFix = undefined;
  mockOffline = false;
  mockFailure = undefined;
  mockRegions = regions;
  mockEmptyRegion = undefined;
  mockCached = new Map();
  chooseCity("");
});

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
    await render(<ExploreScreen />);

    expect(screen.getByRole("header", { name: "Museums near you" })).toBeOnTheScreen();
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

  it("keeps an empty city selectable and requests its listings", async () => {
    mockRegions = [...regions, { region: "paris", lat: 48.8, lng: 2.3 }];
    mockEmptyRegion = "paris";
    await render(<ExploreScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Paris" }));
    expect(screen.getByLabelText("City, Paris")).toBeOnTheScreen();
    expect(screen.getByText("No exhibitions close in the next 30 days.")).toBeOnTheScreen();
    expect(mockRequestRegion).toHaveBeenLastCalledWith({ region: "paris" });

    await fireEvent.press(screen.getByRole("button", { name: "San Francisco Bay Area" }));
    expect(card("Tides of Memory")).toBeOnTheScreen();
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
  it("shows saved exhibitions beyond the backend's per-query limit", async () => {
    const saved = [...Array.from({ length: 100 }, (_, index) => `removed-${index}`), "harbour"];
    await act(() => saved.forEach(toggleWantToSee));
    await render(<WantToSeeScreen />);
    expect(screen.getByRole("button", { name: /^Harbour Drawings, Ends/ })).toBeOnTheScreen();
    await act(() => saved.forEach(toggleWantToSee));
  });

  it("keeps saved shows from multiple cities after changing the browse city", async () => {
    await act(() => {
      toggleWantToSee("tides");
      toggleWantToSee("harbour");
    });
    await render(<WantToSeeScreen />);
    expect(screen.getByRole("button", { name: /^Tides of Memory, Ends/ })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: /^Harbour Drawings, Ends/ })).toBeOnTheScreen();
    await act(() => chooseCity("country:GB"));
    expect(screen.getByRole("button", { name: /^Tides of Memory, Ends/ })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: /^Harbour Drawings, Ends/ })).toBeOnTheScreen();
    await act(() => {
      toggleWantToSee("tides");
      toggleWantToSee("harbour");
    });
  });

  it("lists saved shows until they are removed", async () => {
    await render(<WantToSeeScreen />);
    expect(screen.getByText("Nothing saved yet.")).toBeOnTheScreen();

    await act(() => toggleWantToSee("collection"));
    expect(screen.getByRole("button", { name: /^Collection in Focus, Until/ })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Remove Collection in Focus from Want to see" }));
    expect(screen.getByText("Nothing saved yet.")).toBeOnTheScreen();
  });
});
