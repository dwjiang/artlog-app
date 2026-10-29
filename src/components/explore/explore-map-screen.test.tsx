import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Linking, Platform, ScrollView } from "react-native";

import type { VenueRow } from "@/lib/venue/resolve";
import type { Located } from "@/lib/venue/use-venue";

import { ExploreMapScreen } from "./explore-map-screen";

jest.mock("expo-router", () => ({
  Stack: jest.requireActual("@/components/stack-toolbar-mock").mockStack,
  router: { push: jest.fn() },
}));
jest.mock("expo-network", () => ({ useNetworkState: () => ({ isInternetReachable: true }) }));
const mockResolve = jest.fn<Promise<Located>, []>();
jest.mock("@/lib/venue/use-venue", () => ({ useVenue: () => ({ resolve: mockResolve }) }));
const mockToast = jest.fn();
const mockErrorToast = jest.fn();
jest.mock("@/lib/ui/toast", () => ({
  showToast: (...args: unknown[]) => mockToast(...args),
  showErrorToast: (...args: unknown[]) => mockErrorToast(...args),
}));
jest.mock("@/lib/settings/use-measurement-units", () => ({
  useMeasurementUnits: () => ({ units: "imperial", failed: false }),
}));
jest.mock("@/lib/use-device-ready", () => ({ useDeviceReady: () => false }));
let mockCityMuseums: VenueRow[] = [];
jest.mock("@/lib/venue/venue-db", () => ({
  museumsInRegion: async () => mockCityMuseums,
  onVenueMetadataChange: () => () => {},
}));
jest.mock("convex/react", () => ({
  useMutation: () => ({ withOptimisticUpdate: () => jest.fn() }),
  useQueries: () => ({}),
}));
jest.mock("@/lib/social/use-social-query", () => ({
  useBatchedSocialQuery: (_query: unknown, batches: { museumIds: string[] }[]) => ({
    data: batches.map(({ museumIds }) => museumIds),
    refresh: jest.fn(),
  }),
  useSocialQuery: (query: unknown, args: unknown) => {
    if (args === "skip") return { data: undefined, refresh: jest.fn() };
    const { getFunctionName } = jest.requireActual("convex/server");
    const { bayArea, regions } = jest.requireActual("./__fixtures__/catalog");
    const data = { "exhibitions:regions": regions, "wantToSee:museums": [] }[getFunctionName(query) as string];
    return { data: data ?? bayArea, refresh: jest.fn() };
  },
}));

let mockLocationGranted = true;
jest.mock("expo-location", () => ({
  useForegroundPermissions: () => [{ granted: mockLocationGranted }, jest.fn(), jest.fn()],
}));
const mockSetCameraPosition = jest.fn();
jest.mock("expo-maps", () => {
  const { useImperativeHandle } = jest.requireActual("react");
  const { Pressable, View } = jest.requireActual("react-native");
  return {
    AppleMaps: {
      MapColorScheme: { LIGHT: "light" },
      View: function MockMap({
        ref,
        markers,
        onMarkerClick,
      }: {
        ref: unknown;
        markers: { id: string; title: string }[];
        onMarkerClick?: (marker: { id: string }) => void;
      }) {
        useImperativeHandle(ref, () => ({ setCameraPosition: mockSetCameraPosition }));
        return (
          <View>
            {markers.map((marker) => (
              <Pressable
                key={marker.id}
                accessibilityRole="button"
                accessibilityLabel={`${marker.title} pin`}
                onPress={() => onMarkerClick?.(marker)}
              />
            ))}
          </View>
        );
      },
    },
  };
});

afterEach(() => {
  jest.restoreAllMocks();
  mockCityMuseums = [];
  mockLocationGranted = true;
  mockSetCameraPosition.mockClear();
  mockResolve.mockReset();
  mockToast.mockReset();
  mockErrorToast.mockReset();
});

it("pins a region's nearest 200 museums, then 200 more as the list reaches its end", async () => {
  mockCityMuseums = Array.from({ length: 250 }, (_, index) => ({
    id: `museum-${index}` as VenueRow["id"],
    key: `museum-${index}`,
    name: `Museum ${index}`,
    lat: 37 + index / 1000,
    lng: -122,
    website: null,
    region: "sf-bay-area",
  }));
  await render(<ExploreMapScreen />);

  expect(await screen.findByText("253 museums nearby")).toBeOnTheScreen();
  expect(screen.getAllByRole("button", { name: / pin$/ })).toHaveLength(200);
  // Museums listing shows lead without a location.
  expect(screen.getByRole("button", { name: "Oakland Museum of California pin" })).toBeOnTheScreen();

  await fireEvent(screen.getByTestId("museum-list"), "endReached");
  expect(screen.getAllByRole("button", { name: / pin$/ })).toHaveLength(253);
});

it("reveals the selected museum at the top of the panel on every pin tap", async () => {
  jest.spyOn(Platform, "Version", "get").mockReturnValue("26.5");
  const scrollTo = jest.spyOn(ScrollView.prototype, "scrollTo");
  await render(<ExploreMapScreen />);
  expect(scrollTo).not.toHaveBeenCalled();

  for (const name of [
    "Oakland Museum of California",
    "San Francisco Museum of Modern Art",
    "San Francisco Museum of Modern Art",
  ]) {
    scrollTo.mockClear();
    await fireEvent.press(screen.getByRole("button", { name: `${name} pin` }));

    const selected = screen.getByRole("button", { name: new RegExp(`^${name}`), selected: true });
    expect(screen.getAllByRole("button", { name: / exhibitions?(,|$)/ })[0]).toBe(selected);
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
  }
});

it("centers the map on the phone from the header, once location is on", async () => {
  mockResolve.mockResolvedValue({ fix: { lat: 37.7749, lng: -122.4194, at: 0 } });
  mockLocationGranted = false;
  const view = await render(<ExploreMapScreen />);
  expect(await screen.findByText(/museums nearby$/)).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "My Location" })).toBeNull();

  mockLocationGranted = true;
  await view.rerender(<ExploreMapScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "My Location" }));
  await waitFor(() =>
    expect(mockSetCameraPosition).toHaveBeenCalledWith(
      expect.objectContaining({ coordinates: { latitude: 37.7749, longitude: -122.4194 } }),
    ),
  );
  expect(mockErrorToast).not.toHaveBeenCalled();
});

it("says so when My location can’t find the phone, and tries again on Retry", async () => {
  mockResolve.mockResolvedValueOnce({ failure: "unavailable" });
  await render(<ExploreMapScreen />);
  await fireEvent.press(await screen.findByRole("button", { name: "My Location" }));
  await waitFor(() =>
    expect(mockErrorToast).toHaveBeenCalledWith("Couldn’t find your location.", expect.any(Function)),
  );
  expect(mockSetCameraPosition).not.toHaveBeenCalled();

  mockResolve.mockResolvedValueOnce({ fix: { lat: 37.7749, lng: -122.4194, at: 0 } });
  const [, retry] = mockErrorToast.mock.calls[0] as [string, () => void];
  retry();
  await waitFor(() => expect(mockSetCameraPosition).toHaveBeenCalledTimes(1));
});

it("points to Settings when My location finds location access off", async () => {
  const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
  mockResolve.mockResolvedValue({ failure: "denied" });
  await render(<ExploreMapScreen />);
  await fireEvent.press(await screen.findByRole("button", { name: "My Location" }));
  await waitFor(() =>
    expect(mockToast).toHaveBeenCalledWith("Allow location in Settings to show where you are.", {
      label: "Settings",
      onPress: expect.any(Function),
    }),
  );
  const [, action] = mockToast.mock.calls[0] as [string, { onPress: () => void }];
  action.onPress();
  expect(openSettings).toHaveBeenCalledTimes(1);
  expect(mockSetCameraPosition).not.toHaveBeenCalled();
});
