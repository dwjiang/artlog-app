import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Alert } from "react-native";

import type { DownloadSnapshot } from "@/lib/museum-downloads/controller";
import type { MuseumSummary } from "@/shared/offline/types";

import { MuseumDownloadsScreen } from "./museum-downloads-screen";

const museum: MuseumSummary = {
  id: "chicago" as never,
  // The real key selects the bundled hero image in the row and the detail view.
  key: "wikidata:Q239303",
  name: "Art Institute of Chicago",
  city: "Chicago",
  lat: 1,
  lng: 1,
  size: 10_000_000,
  count: 20,
  version: "v1",
  modelVersion: "m",
  previews: [],
};
const other = {
  ...museum,
  id: "boston" as never,
  name: "Boston Museum",
  city: "Boston",
  size: 1_000_000,
};
let mockState: DownloadSnapshot;
const mockStart = jest.fn();
const mockPause = jest.fn();
const mockRemove = jest.fn();
const mockCancel = jest.fn();
jest.mock("@/lib/museum-downloads/use-museum-downloads", () => ({
  useMuseumDownloads: () => mockState,
}));
jest.mock("@/lib/museum-downloads/storage", () => ({
  previewUri: () => undefined,
  museumDownloads: {
    start: (...args: unknown[]) => mockStart(...args),
    pause: (...args: unknown[]) => mockPause(...args),
    remove: (...args: unknown[]) => mockRemove(...args),
    cancel: (...args: unknown[]) => mockCancel(...args),
    getSnapshot: () => mockState,
    pauseAll: async () => {},
  },
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn() }) }));
jest.mock("expo-network", () => ({
  useNetworkState: () => ({ isConnected: true }),
}));
jest.mock("expo-location", () => ({
  getForegroundPermissionsAsync: async () => ({ granted: false }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34 }),
}));
jest.mock("@/components/toast", () => ({ ToastLayer: () => null }));
jest.mock("@/lib/ui/toast", () => ({ showToast: jest.fn(), showErrorToast: jest.fn() }));
jest.mock("@expo/ui/community/menu", () => {
  const { Pressable, Text, View } = jest.requireActual("react-native");
  return {
    MenuView: ({
      children,
      actions,
      onPressAction,
    }: {
      children: React.ReactNode;
      actions: { id: string; title: string }[];
      onPressAction: (event: unknown) => void;
    }) => (
      <View>
        {children}
        {actions.map((action) => (
          <Pressable
            key={action.id}
            accessibilityRole="menuitem"
            onPress={() => onPressAction({ nativeEvent: { event: action.id } })}
          >
            <Text>{action.title}</Text>
          </Pressable>
        ))}
      </View>
    ),
  };
});
beforeEach(() => {
  jest.clearAllMocks();
  mockState = {
    catalog: [other, museum],
    downloads: {},
    loaded: true,
    loading: false,
  };
  for (const fn of [mockStart, mockPause, mockRemove, mockCancel]) {
    fn.mockResolvedValue(undefined);
  }
});
afterEach(() => jest.restoreAllMocks());

it("searches museums, sorts by size, and preserves the search when returning from details", async () => {
  await render(<MuseumDownloadsScreen />);
  expect(screen.getAllByRole("button", { name: /^View / }).map((item) => item.props.accessibilityLabel)).toEqual([
    "View Art Institute of Chicago",
    "View Boston Museum",
  ]);
  await fireEvent.press(screen.getByRole("menuitem", { name: "Download size" }));
  expect(screen.getAllByRole("button", { name: /^View / }).map((item) => item.props.accessibilityLabel)).toEqual([
    "View Boston Museum",
    "View Art Institute of Chicago",
  ]);
  await fireEvent.changeText(screen.getByLabelText("Search museums"), "Chicago");
  expect(screen.queryByRole("button", { name: "View Boston Museum" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "View Art Institute of Chicago" }));
  expect(screen.getByText("Scan and read offline.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Download · 10 MB" }));
  expect(mockStart).toHaveBeenCalledWith(museum);
  await fireEvent.press(screen.getByRole("button", { name: "Back to museum downloads" }));
  expect(screen.getByLabelText("Search museums").props.value).toBe("Chicago");
  await fireEvent.press(screen.getByRole("button", { name: "Clear search" }));
  expect(screen.getAllByRole("button", { name: /^View / })).toHaveLength(2);
});

it("pauses and cancels directly from the list without opening a museum", async () => {
  mockState.downloads[museum.id] = {
    museum,
    status: "downloading",
    completed: 0,
  };
  await render(<MuseumDownloadsScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Pause Art Institute of Chicago" }));
  expect(mockPause).toHaveBeenCalledWith(museum.id);
  await fireEvent.press(screen.getByRole("menuitem", { name: "Cancel download" }));
  expect(mockCancel).toHaveBeenCalledWith(museum.id);
});

it("requires the list removal confirmation before deleting a ready download", async () => {
  mockState.downloads[museum.id] = { museum, status: "ready", completed: 3 };
  const alert = jest.spyOn(Alert, "alert");
  await render(<MuseumDownloadsScreen />);
  expect(screen.getByText("✓ Ready offline")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("menuitem", { name: "Remove download" }));
  expect(mockRemove).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith(
    "Remove Art Institute of Chicago?",
    "Free 10 MB. Your saved artworks, notes, and photos will stay.",
    expect.any(Array),
  );
  await act(async () => {
    alert.mock.calls[0][2]?.find((action) => action.text === "Remove download")?.onPress?.();
  });
  expect(mockRemove).toHaveBeenCalledWith(museum.id);
});

it("labels the cached previews of a downloaded package even after the catalog advertises a newer build", async () => {
  const downloaded = {
    ...museum,
    version: "v1",
    previews: [{ title: "Water Lilies", url: "https://images.museum/v1.jpg" }],
  };
  mockState.catalog = [
    {
      ...museum,
      version: "v2",
      previews: [{ title: "Haystacks", url: "https://images.museum/v2.jpg" }],
    },
  ];
  mockState.downloads[museum.id] = {
    museum: downloaded,
    status: "ready",
    completed: 1,
    active: { manifest: { ...downloaded, chunks: [] }, folder: "chicago-v1" },
  };
  await render(<MuseumDownloadsScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "View Art Institute of Chicago" }));
  expect(screen.getByLabelText("Water Lilies")).toBeOnTheScreen();
  expect(screen.queryByLabelText("Haystacks")).toBeNull();
});
