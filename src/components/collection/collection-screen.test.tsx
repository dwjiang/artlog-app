import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { FlatList, StyleSheet } from "react-native";

import { insertSavedWork } from "@/db/repos/saved-works";
import { upsertVisit } from "@/db/repos/visits";
import { anonymousOwner, switchOwner } from "@/lib/account/owner-store";

import type { Id } from "../../../convex/_generated/dataModel";
import { AllArtworksScreen } from "./all-artworks-screen";
import { CollectionScreen } from "./collection-screen";

jest.mock("@/lib/audio/use-listening");

jest.mock("expo-network", () => ({
  useNetworkState: () => ({ isInternetReachable: true }),
}));
jest.mock("@/lib/venue/use-venue", () => ({ useVenue: () => ({}) }));
jest.mock("./collection-header", () => ({ CollectionHeader: () => null }));
jest.mock("@/lib/wall/use-collection-wall", () => ({
  useCollectionWall: () => ({
    signedIn: false,
    draft: null,
    repository: { getSnapshot: () => ({ acknowledged: null }) },
  }),
}));
jest.mock("@/lib/social/use-social-session", () => ({
  useSocialSession: () => ({ status: "signed-out", key: "guest" }),
}));
jest.mock("@/lib/social/use-social-query", () => ({
  useSocialQuery: () => ({}),
}));
const mockHrefs: unknown[] = [];
let mockParams: { view?: string } = {};
let mockCollectionFailureOnNextMount = false;
let mockSetCollectionFailure: (failed: boolean) => void;
jest.mock("@/lib/collection/use-collection-data", () => ({
  useCollectionData: () => {
    const data = jest.requireActual("@/lib/collection/use-collection-data").useCollectionData();
    const [failed, setFailed] = jest.requireActual("react").useState(() => {
      const failed = mockCollectionFailureOnNextMount;
      mockCollectionFailureOnNextMount = false;
      return failed;
    });
    mockSetCollectionFailure = setFailed;
    return failed ? { ...data, loading: false, error: new Error("Local read failed") } : data;
  },
}));
jest.mock("@/components/visits/globe-canvas", () => ({ GlobeCanvas: () => null }));
jest.mock("@/lib/venue/venue-db", () => ({
  venueMetadataForIds: async () => [],
  onVenueMetadataChange: () => () => {},
}));

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
jest.mock("@/lib/files/photos", () => ({
  captureFileUri: (path: string) => `file:///documents/${path}`,
}));
jest.mock("expo-router", () => {
  const { Pressable, TextInput, View, Text } = jest.requireActual("react-native");
  return {
    router: {
      push: jest.fn(),
      setParams: (params: { view?: string }) => {
        mockParams = params;
      },
    },
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (callback: () => void) => jest.requireActual("react").useEffect(callback, [callback]),
    Link: ({ href, asChild, children }: { href: unknown; asChild?: boolean; children: ReactNode }) => {
      mockHrefs.push(href);
      return asChild ? children : <Pressable accessibilityRole="link">{children}</Pressable>;
    },
    Stack: {
      Toolbar: Object.assign(View, {
        Button: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
          <Pressable accessibilityRole="button" onPress={onPress}>
            <Text>{children}</Text>
          </Pressable>
        ),
      }),
      SearchBar: ({
        placeholder,
        onChangeText,
      }: {
        placeholder: string;
        onChangeText: (event: { nativeEvent: { text: string } }) => void;
      }) => (
        <TextInput placeholder={placeholder} onChangeText={(text: string) => onChangeText({ nativeEvent: { text } })} />
      ),
    },
  };
});
jest.mock("./collection-wall", () => {
  const { ScrollView, Text, View } = jest.requireActual("react-native");
  const { useRef } = jest.requireActual("react");
  const { usePaneRoom } = jest.requireActual("@/components/pane-scroll");
  return {
    CollectionWall: ({ header, controls, paneRef }: { header: ReactNode; controls: ReactNode; paneRef: unknown }) => {
      const scroll = useRef(null);
      const room = usePaneRoom(scroll, { handle: paneRef });
      return (
        <ScrollView ref={scroll} testID="wall" onLayout={room.onLayout} onScroll={room.onScroll}>
          {header}
          <View testID="wall-controls" onLayout={room.onPinnedLayout}>
            {controls}
          </View>
          <Text>Collection wall</Text>
        </ScrollView>
      );
    },
  };
});
async function renderArchive() {
  await render(<AllArtworksScreen />);
}

it("opens the wall for guests without a sign-in gate", async () => {
  await render(<CollectionScreen />);
  expect(screen.getByText("Collection wall")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Wall" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Visits" })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  expect(screen.queryByText("Keep your collection across devices")).toBeNull();
});

const venueId = "museum-1" as Id<"museums">;
const search = () => screen.getByPlaceholderText(/Title, artist, date or place|Search your visits/);

beforeEach(() => {
  mockParams = {};
  mockCollectionFailureOnNextMount = false;
  mockHrefs.length = 0;
  switchOwner(anonymousOwner(), "scope-anonymous");
});

it("retries a failed local collection read without leaving Visits", async () => {
  switchOwner("device:retry-collection", "scope-retry-collection");
  mockCollectionFailureOnNextMount = true;
  await render(<CollectionScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Visits" }));
  expect(screen.getByText(/Your visits could not load/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "List" }));
  await fireEvent.changeText(screen.getByLabelText("Search your visits"), "museum");
  await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("No visits found.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Visits" })).toBeSelected();
  expect(screen.getByLabelText("Search your visits")).toHaveDisplayValue("museum");
});

it("keeps loaded visits through repeated failed retries and replaces them after recovery", async () => {
  switchOwner("device:retry-snapshot", "scope-retry-snapshot");
  const visit = {
    visitedOn: "2026-09-08",
    timeZone: "UTC",
    localId: "77777777-1111-4111-8111-111111111111",
    venueId,
    venueName: "Review Museum",
    startedAt: new Date(2026, 8, 8, 14).getTime(),
  };
  await upsertVisit(visit);
  await render(<CollectionScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Visits" }));
  await fireEvent.press(await screen.findByRole("button", { name: "List" }));
  expect(await screen.findByText("Review Museum")).toBeVisible();
  const field = screen.getByLabelText("Search your visits");
  await act(() => mockSetCollectionFailure(true));
  for (let retry = 0; retry < 2; retry++) {
    expect(screen.getByText("Review Museum")).toBeVisible();
    mockCollectionFailureOnNextMount = true;
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/Your visits could not load/)).toBeVisible();
    expect(screen.getByLabelText("Search your visits") === field).toBe(true);
    expect(screen.getByText("Review Museum")).toBeVisible();
  }
  await upsertVisit({ ...visit, venueName: "Renamed Museum" });
  await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Renamed Museum")).toBeVisible();
  expect(screen.queryByText("Review Museum")).toBeNull();
  expect(screen.queryByText(/Your visits could not load/)).toBeNull();
  await act(() => switchOwner("device:other-retry-owner", "scope-other-retry-owner"));
  expect(screen.queryByText("Renamed Museum", { includeHiddenElements: true })).toBeNull();
});

it("keeps the public wall as the account collection view", async () => {
  switchOwner("account:a", "scope-a");
  await render(<CollectionScreen />);
  expect(screen.getByText("Collection wall")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Wall" })).toBeOnTheScreen();
  expect(screen.queryByText("Keep your collection across devices")).toBeNull();
});

async function openVisitsFromScrolledWall() {
  await render(<CollectionScreen />);
  await fireEvent(screen.getByTestId("wall-controls"), "layout", {
    nativeEvent: { layout: { x: 0, y: 300, width: 402, height: 60 } },
  });
  await fireEvent.scroll(screen.getByTestId("wall"), { nativeEvent: { contentOffset: { x: 0, y: 83 } } });
  await fireEvent.press(screen.getByRole("button", { name: "Visits" }));
}

it("opens Visits with the header where the scrolled wall left it", async () => {
  switchOwner("device:pane-switch", "scope-pane-switch");
  await upsertVisit({
    visitedOn: "2026-09-08",
    timeZone: "UTC",
    localId: "88888888-1111-4111-8111-111111111111",
    venueId,
    venueName: "Pane Museum",
    startedAt: new Date(2026, 8, 8, 14).getTime(),
  });
  const scrollToOffset = jest.spyOn(FlatList.prototype, "scrollToOffset");
  try {
    await openVisitsFromScrolledWall();
    expect(await screen.findByRole("button", { name: "List" })).toBeVisible();
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 83, animated: false });
  } finally {
    scrollToOffset.mockRestore();
  }
});

it("opens empty Visits at rest, since its empty state has no room to scroll", async () => {
  switchOwner("device:empty-pane-switch", "scope-empty-pane-switch");
  const scrollToOffset = jest.spyOn(FlatList.prototype, "scrollToOffset");
  try {
    await openVisitsFromScrolledWall();
    expect(await screen.findByText("No visits yet.")).toBeVisible();
    expect(scrollToOffset).not.toHaveBeenCalled();
  } finally {
    scrollToOffset.mockRestore();
  }
});

it("keeps the hidden section laid out behind the shown one", async () => {
  switchOwner("account:sections", "scope-sections");
  await render(<CollectionScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Visits" }));
  expect(await screen.findByText("No visits yet.")).toBeVisible();
  const wall = screen.getByText("Collection wall", { includeHiddenElements: true });
  expect(screen.queryByText("Collection wall")).toBeNull();
  expect(wall).not.toBeVisible();
  // Fabric never mounts a `display: "none"` subtree, so its SwiftUI controls would first size themselves when shown.
  for (let node: typeof wall | null = wall; node; node = node.parent) {
    expect(StyleSheet.flatten(node.props.style)?.display).not.toBe("none");
  }
  // react-native-screens scrolls the first subview chain to the top when the tab is tapped again.
  expect(
    screen
      .getAllByText(/^(No visits yet\.|Collection wall)$/, { includeHiddenElements: true })
      .map((node) => node.props.children),
  ).toEqual(["No visits yet.", "Collection wall"]);
});

it("invites the first scan while the collection is empty", async () => {
  await renderArchive();
  expect(await screen.findByText("No saved artworks yet.")).toBeOnTheScreen();
  expect(screen.getByText("Scan an artwork to add it to your collection.")).toBeOnTheScreen();
});

it("shows the first saved artwork without a sync prompt", async () => {
  switchOwner("device:first-save", "scope-first-save");
  const empty = await render(<AllArtworksScreen />);
  expect(await screen.findByText("No saved artworks yet.")).toBeOnTheScreen();
  expect(screen.queryByText("Keep your collection across devices")).toBeNull();
  await empty.unmount();
  await act(async () => {
    await insertSavedWork({
      localId: "first-artwork",
      savedAt: 1,
      title: "First artwork",
      artist: "First artist",
    });
  });
  await renderArchive();
  expect(await screen.findByRole("button", { name: "First artwork, First artist" })).toBeOnTheScreen();
  expect(screen.queryByText("Keep your collection across devices")).toBeNull();
  expect(screen.queryByRole("button", { name: "Not Now" })).toBeNull();
});

describe("with saved works", () => {
  beforeAll(async () => {
    switchOwner(anonymousOwner(), "scope-anonymous");
    await upsertVisit({
      visitedOn: "2026-09-08",
      timeZone: "UTC",
      localId: "7e5de765-90f8-5015-b60d-2652d64b650f",
      venueId,
      venueName: "Metropolitan Museum of Art",
      startedAt: new Date(2026, 8, 8, 14).getTime(),
    });
    await upsertVisit({
      visitedOn: "2026-09-01",
      timeZone: "UTC",
      localId: "b00e1cd6-0fef-559f-88cc-0b73a2c7ae58",
      venueId,
      venueName: "de Young",
      startedAt: new Date(2026, 8, 1, 11).getTime(),
    });
    await insertSavedWork({
      localId: "lilies",
      visitLocalId: "7e5de765-90f8-5015-b60d-2652d64b650f",
      venueId,
      savedAt: 3,
      title: "Water Lilies",
      artist: "Claude Monet",
      institution: "Musée d'Orsay",
      cropPath: "crops/lilies.jpg",
    });
    await insertSavedWork({
      localId: "cotton",
      visitLocalId: "b00e1cd6-0fef-559f-88cc-0b73a2c7ae58",
      venueId,
      savedAt: 2,
      title: "100% Cotton",
      artist: "Anon",
      institution: "de Young",
      cropPath: "crops/cotton.jpg",
    });
    await insertSavedWork({
      localId: "import",
      savedAt: 1,
      title: "Untitled",
      artist: "Unknown",
      cropPath: "crops/import.jpg",
    });
  });

  it("shows every work in artist order, each linking to its detail", async () => {
    await renderArchive();
    await fireEvent.press(screen.getByRole("button", { name: "Artist" }));
    expect(await screen.findByRole("button", { name: "Water Lilies, Claude Monet" })).toBeOnTheScreen();
    expect(screen.getAllByRole("button", { name: /, / }).map((cell) => cell.props.accessibilityLabel)).toEqual([
      "100% Cotton, Anon",
      "Water Lilies, Claude Monet",
      "Untitled, Unknown",
    ]);
    expect(mockHrefs).toContainEqual({
      pathname: "/saved/[savedId]",
      params: { savedId: "lilies" },
    });
    expect(screen.getByText("Water Lilies")).toBeOnTheScreen();
    expect(screen.getByText("Claude Monet")).toBeOnTheScreen();
  });

  it("narrows the grid with the header search and explains an empty match", async () => {
    await renderArchive();
    await screen.findByRole("button", { name: "Water Lilies, Claude Monet" });
    await fireEvent.changeText(search(), "MONET");
    expect(screen.getAllByRole("button", { name: /, / })).toHaveLength(1);
    await fireEvent.changeText(search(), "orsay");
    expect(screen.getByRole("button", { name: "Water Lilies, Claude Monet" })).toBeOnTheScreen();
    await fireEvent.changeText(search(), "vermeer ");
    expect(screen.getByText("No artworks found.")).toBeOnTheScreen();
    await fireEvent.changeText(search(), "");
    expect(screen.getAllByRole("button", { name: /, / })).toHaveLength(3);
  });

  it("opens a visit timeline with whole visits and keeps imports in All artworks", async () => {
    await render(<CollectionScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Visits" }));
    await fireEvent.press(screen.getByRole("button", { name: "List" }));
    expect(screen.getByText("Metropolitan Museum of Art")).toBeOnTheScreen();
    expect(screen.getByText("de Young")).toBeOnTheScreen();
    expect(screen.queryByText("Imported")).toBeNull();
    expect(mockHrefs).toContainEqual({
      pathname: "/journal/[visitId]",
      params: { visitId: "7e5de765-90f8-5015-b60d-2652d64b650f" },
    });
    await fireEvent.changeText(search(), "cotton");
    expect(screen.queryByText("Metropolitan Museum of Art")).toBeNull();
    expect(screen.getByText("de Young")).toBeOnTheScreen();
  });
});

it("immediately hides account works on sign-out and restores them on sign-in", async () => {
  await insertSavedWork(
    {
      localId: "account-work",
      savedAt: 10,
      title: "Private account work",
      artist: "Reader",
    },
    "account:a",
  );
  switchOwner("account:a", "scope-a");
  await renderArchive();
  expect(await screen.findByText("Private account work")).toBeOnTheScreen();
  await act(() => switchOwner(anonymousOwner(), "scope-anonymous"));
  expect(screen.queryByText("Private account work")).toBeNull();
  await act(() => switchOwner("account:a", "scope-a2"));
  expect(await screen.findByText("Private account work")).toBeOnTheScreen();
});

it("shows empty visits and calendar month groups, and searches them by country or date", async () => {
  switchOwner("account:empty", "scope-empty");
  await upsertVisit({
    localId: "00000000-0000-4000-8000-000000000001",
    venueId,
    venueName: "Empty Museum",
    visitedOn: "2024-02-29",
    timeZone: "UTC",
  });
  await render(<CollectionScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Visits" }));
  await fireEvent.press(screen.getByRole("button", { name: "List" }));
  expect(screen.getByText("February 2024")).toBeOnTheScreen();
  expect(screen.getByText("Empty Museum")).toBeOnTheScreen();
  expect(screen.getByText(/Location unavailable · 0 artworks/)).toBeOnTheScreen();
  await fireEvent.changeText(search(), "2024-02-29");
  expect(screen.getByText("Empty Museum")).toBeOnTheScreen();
  await fireEvent.changeText(search(), "missing");
  expect(screen.getByText("No visits found.")).toBeOnTheScreen();
});

it("shows the A–Z collection in artist order", async () => {
  switchOwner(anonymousOwner(), "scope-anonymous");
  await renderArchive();
  await screen.findByText("Water Lilies");
  await fireEvent.press(screen.getByRole("button", { name: "Artist" }));
  expect(screen.getAllByRole("button", { name: /, / }).map((row) => row.props.accessibilityLabel)).toEqual([
    "100% Cotton, Anon",
    "Water Lilies, Claude Monet",
    "Untitled, Unknown",
  ]);
});

it("opens the requested collection section even after another section was selected", async () => {
  switchOwner("account:section", "scope-section");
  const view = await render(<CollectionScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Visits" }));
  expect(screen.getByRole("button", { name: "Visits" })).toBeSelected();
  mockParams = { view: "wall" };
  await view.rerender(<CollectionScreen />);
  expect(screen.getByRole("button", { name: "Wall" })).toBeSelected();
  expect(mockParams.view).toBeUndefined();
  mockParams = { view: "visits" };
  await view.rerender(<CollectionScreen />);
  expect(screen.getByRole("button", { name: "Visits" })).toBeSelected();
});
