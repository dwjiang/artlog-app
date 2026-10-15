import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert, type AlertButton } from "react-native";

import type { ArtworkPhoto } from "@/db/schema";
import type { VisitSummary } from "@/lib/journal/visit-summaries";
import { playErrorHaptic, playSuccessHaptic, playToggleHaptic } from "@/lib/ui/haptics";
import type { useVisitSharing } from "@/lib/visits/use-visit-sharing";

import { VisitShareLayout } from "./visit-share-flow";

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockDismiss = jest.fn();
const mockDismissAll = jest.fn();
const mockNavigate = jest.fn();
const mockReplace = jest.fn();
const mockToast = jest.fn();
const mockOfferNotifications = jest.fn();
const mockController = {
  load: jest.fn(),
  edit: jest.fn(),
  publish: jest.fn(),
};
const mockPatchVisit = jest.fn();
const mockGrid = jest.fn();
const mockUseSharing = jest.fn();
const mockMentionQuery = jest.fn();
let mockAudience: string | undefined;
// Drag gestures cannot run under Jest, so the grid renders its items in order and exposes its props for reordering.
jest.mock("react-native-sortables", () => {
  const React = jest.requireActual("react");
  const { View } = jest.requireActual("react-native");
  return {
    __esModule: true,
    default: {
      Grid: (props: {
        data: unknown[];
        keyExtractor: (item: unknown) => string;
        renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
      }) => {
        mockGrid(props);
        return React.createElement(
          View,
          null,
          props.data.map((item, index) =>
            React.createElement(View, { key: props.keyExtractor(item) }, props.renderItem({ item, index })),
          ),
        );
      },
    },
  };
});
jest.mock("@/db/repos/visits", () => ({
  patchVisit: (...args: unknown[]) => mockPatchVisit(...args),
}));
jest.mock("@/lib/ui/haptics");
jest.mock("@/lib/ui/toast", () => ({
  showToast: (...args: unknown[]) => mockToast(...args),
}));
jest.mock("@/lib/notifications/offer", () => ({ offerNotifications: () => mockOfferNotifications() }));
let mockPage: "index" | "photos" | "companions" = "index";
let mockSharing: ReturnType<typeof useVisitSharing>;
let mockPhotos: ArtworkPhoto[] = [];
const mockVisit = {
  visibility: "public",
  localId: "visit",
  owner: "account:a",
  venueName: "Museum",
  visitedOn: "2024-02-29",
  reflection: "PRIVATE REFLECTION",
  works: [
    {
      localId: "save",
      title: "Water Lilies",
      artist: "Claude Monet",
      cropPath: null,
    },
  ],
} as VisitSummary;
jest.mock("@/lib/journal/use-visits", () => ({
  useVisits: () => ({
    owner: mockVisit.owner,
    visits: [mockVisit],
    loading: false,
  }),
}));
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 116 }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));
jest.mock("@/lib/visits/use-visit-sharing", () => ({
  useVisitSharing: (...args: unknown[]) => {
    mockUseSharing(...args);
    return mockSharing;
  },
}));
jest.mock("@/components/social/profile-form", () => ({ ProfileForm: () => null }));
const mockFriend = (profileId: string, name: string, username: string) => ({
  profileId,
  name,
  username,
  avatar: "vermeer" as const,
  publishedWallCount: 0,
});
let mockFriends = [mockFriend("maya", "Maya Chen", "maya"), mockFriend("jonah", "Jonah Park", "jonahp")];
let mockSafetyChecks = true;
const mockSetSafetyChecks = jest.fn();
jest.mock("convex/react", () => ({ ...jest.requireActual("convex/react"), useMutation: () => mockSetSafetyChecks }));
jest.mock("@/lib/social/use-social-session", () => ({
  useSocialSession: () => ({
    key: "a",
    status: "ready",
    profileId: "me",
    offline: false,
    safetyChecks: mockSafetyChecks,
  }),
}));
jest.mock("@/lib/social/use-friends", () => ({
  useFriends: () => ({ data: mockFriends, loading: false, error: undefined, refresh: jest.fn() }),
}));
jest.mock("@/lib/social/use-social-query", () => ({
  useSocialQuery: (reference: never, args: unknown) => {
    if (jest.requireActual("convex/server").getFunctionName(reference) === "mentions:suggest") {
      mockMentionQuery(args);
    }
    return { data: [], refresh: jest.fn() };
  },
}));
jest.mock("@/components/settings/account-section", () => ({
  AccountSection: () => null,
}));
jest.mock("drizzle-orm/expo-sqlite", () => ({
  ...jest.requireActual("drizzle-orm/expo-sqlite"),
  useLiveQuery: () => ({ data: mockPhotos }),
}));
jest.mock("@/components/collection/saved-work-image", () => ({
  SavedWorkImage: ({ title, path }: { title: string; path: string | null }) => {
    const { Text } = jest.requireActual("react-native");
    return (
      <Text>
        {title}: {path ?? "no selected photo"}
      </Text>
    );
  },
}));
jest.mock("expo-router", () => {
  const React = jest.requireActual("react");
  const { Pressable, Text, View } = jest.requireActual("react-native");
  const ToolbarButton = ({
    children,
    disabled,
    onPress,
  }: {
    children: string;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
    >
      <Text>{children}</Text>
    </Pressable>
  );
  return {
    useRouter: () => ({ push: mockPush }),
    router: {
      push: (...args: unknown[]) => mockPush(...args),
      replace: (...args: unknown[]) => mockReplace(...args),
      navigate: (...args: unknown[]) => mockNavigate(...args),
      back: () => mockBack(),
      dismiss: () => mockDismiss(),
      dismissAll: () => mockDismissAll(),
    },
    useLocalSearchParams: () => ({ visitId: "visit", saveId: "save", audience: mockAudience }),
    useFocusEffect: (effect: () => void) => React.useEffect(effect, [effect]),
    useSegments: () => ["visit-share", "[visitId]"],
    useNavigation: () => ({ getState: () => undefined }),
    Stack: Object.assign(
      () => {
        const screens = jest.requireActual("./visit-share-flow");
        return React.createElement(
          mockPage === "photos"
            ? screens.VisitSharePhotosScreen
            : mockPage === "companions"
              ? screens.VisitShareCompanionsScreen
              : screens.VisitShareScreen,
        );
      },
      {
        Screen: () => null,
        Toolbar: Object.assign(View, { View, Button: ToolbarButton }),
      },
    ),
  };
});
beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  mockSafetyChecks = true;
  mockPage = "index";
  mockAudience = undefined;
  mockFriends = [mockFriend("maya", "Maya Chen", "maya"), mockFriend("jonah", "Jonah Park", "jonahp")];
  mockVisit.owner = "account:a";
  mockVisit.visibility = "public";
  mockPhotos = [];
  mockVisit.works = [
    {
      localId: "save",
      title: "Water Lilies",
      artist: "Claude Monet",
      cropPath: null,
    },
  ] as VisitSummary["works"];
  mockSharing = {
    acknowledged: {
      audience: "public",
      postId: null,
      status: "private",
      removed: false,
      revision: 0,
      saveLocalIds: [],
      reflection: "",
      companions: [],
    },
    draft: {
      audience: "public",
      visitLocalId: "visit",
      revision: 0,
      saveLocalIds: ["save"],
      reflection: "",
      color: "#CDD0CA",
      pattern: "stripe",
      companionIds: [],
    },
    profileRequired: false,
    conflict: false,
    busy: false,
    controller: mockController,
    token: "token",
  } as unknown as ReturnType<typeof useVisitSharing>;
});

it("shows visual progress before sharing starts and replaces a load failure with retry guidance", async () => {
  mockSharing.draft = null;
  const view = await render(<VisitShareLayout />);
  expect(screen.getByRole("progressbar", { name: "Preparing sharing…" })).toBeOnTheScreen();
  expect(screen.queryByText("Preparing sharing…")).toBeNull();
  mockSharing.error = "Connection failed";
  await view.rerender(<VisitShareLayout />);
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.getByText("Sharing could not load.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
  expect(mockController.load).toHaveBeenCalledTimes(2);
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(mockDismiss).toHaveBeenCalledTimes(1);
});

it("uses the explicitly selected visit photo on the tile and the wallpaper row, including a selected label", async () => {
  mockVisit.works[0].cropPath = "private-original.jpg";
  mockPhotos = [
    {
      owner: "account:a",
      localId: "chosen-label",
      savedLocalId: "save",
      visitLocalId: "visit",
      path: "selected-label.jpg",
      kind: "label",
      deletedAt: null,
    } as ArtworkPhoto,
  ];
  mockSharing.draft!.photoSelections = [{ saveLocalId: "save", photoLocalIds: ["chosen-label"] }];
  const view = await render(<VisitShareLayout />);
  expect(screen.getAllByText("Water Lilies: selected-label.jpg")).toHaveLength(2);
  mockSharing.draft!.photoSelections = [];
  await view.rerender(<VisitShareLayout />);
  expect(screen.queryByText("Water Lilies: selected-label.jpg")).toBeNull();
  expect(screen.getAllByText("Water Lilies: no selected photo")).toHaveLength(2);
});

it("counts only the selected photos that are still available on the wallpaper row", async () => {
  const photo = { owner: "account:a", savedLocalId: "save", visitLocalId: "visit", kind: "full", deletedAt: null };
  mockPhotos = [
    { ...photo, localId: "front", path: "front.jpg" },
    { ...photo, localId: "detail", path: "detail.jpg" },
    { ...photo, localId: "gone", path: "gone.jpg", deletedAt: 1 },
  ] as ArtworkPhoto[];
  mockSharing.draft!.photoSelections = [{ saveLocalId: "save", photoLocalIds: ["front", "detail", "gone"] }];
  const view = await render(<VisitShareLayout />);
  expect(screen.getByLabelText("Water Lilies, Claude Monet, 2 photos")).toBeOnTheScreen();
  mockSharing.draft!.photoSelections = [{ saveLocalId: "save", photoLocalIds: ["front", "gone"] }];
  await view.rerender(<VisitShareLayout />);
  expect(screen.getByLabelText("Water Lilies, Claude Monet")).toBeOnTheScreen();
});

it("does not use another owner, visit, artwork, deleted, or unselected photo for the feed preview", async () => {
  mockVisit.works[0].cropPath = "private-original.jpg";
  const photo = {
    owner: "account:a",
    localId: "chosen",
    savedLocalId: "save",
    visitLocalId: "visit",
    path: "must-stay-private.jpg",
    kind: "full",
    deletedAt: null,
  } as ArtworkPhoto;
  mockPhotos = [
    { ...photo, owner: "account:b" },
    { ...photo, visitLocalId: "other-visit" },
    { ...photo, savedLocalId: "other-save" },
    { ...photo, deletedAt: 1 },
    { ...photo, localId: "unselected" },
  ];
  mockSharing.draft!.photoSelections = [{ saveLocalId: "save", photoLocalIds: ["chosen"] }];
  await render(<VisitShareLayout />);
  expect(screen.getAllByText("Water Lilies: no selected photo")).toHaveLength(2);
  expect(screen.queryByText(/must-stay-private|private-original/)).toBeNull();
});

it("shows a left-out artwork with the photo including it would add, never its label photo", async () => {
  const photo = {
    owner: "account:a",
    savedLocalId: "save",
    visitLocalId: "visit",
    deletedAt: null,
  };
  mockPhotos = [
    { ...photo, localId: "label", path: "label.jpg", kind: "label" },
    { ...photo, localId: "full", path: "artwork.jpg", kind: "full" },
  ] as ArtworkPhoto[];
  mockSharing.draft = { ...mockSharing.draft!, saveLocalIds: [] };
  await render(<VisitShareLayout />);
  expect(screen.getByText("Water Lilies: artwork.jpg")).toBeOnTheScreen();
  expect(screen.queryByTestId("art-band")).toBeNull();
  expect(screen.getByRole("checkbox", { name: "Share Water Lilies", checked: false })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: /Choose photos/ })).toBeNull();
});

it("numbers the shared artworks in order and opens a shared artwork's photo choice from its tile", async () => {
  mockVisit.works = ["a", "b", "c", "d", "e"].map((id) => ({
    localId: id,
    title: `Work ${id}`,
    artist: "",
    cropPath: null,
  })) as VisitSummary["works"];
  mockPhotos = [
    {
      owner: "account:a",
      localId: "photo",
      savedLocalId: "d",
      visitLocalId: "visit",
      path: "photo.jpg",
      kind: "full",
      deletedAt: null,
    } as ArtworkPhoto,
  ];
  mockSharing.draft = { ...mockSharing.draft!, saveLocalIds: ["d", "b", "a", "c"] };
  await render(<VisitShareLayout />);
  expect(screen.getByText("4 of 5 · drag to reorder")).toBeOnTheScreen();
  const order = mockGrid.mock.lastCall![0].data.map((work: { localId: string }) => work.localId);
  expect(order).toEqual(["d", "b", "a", "c", "e"]);
  expect(screen.getByRole("checkbox", { name: "Share Work d", value: { text: "1" } })).toBeOnTheScreen();
  expect(screen.getByRole("checkbox", { name: "Share Work a", value: { text: "3" } })).toBeOnTheScreen();
  expect(screen.getByRole("checkbox", { name: "Share Work c", value: { text: "4" } })).toBeOnTheScreen();
  expect(screen.getByRole("checkbox", { name: "Share Work e", checked: false })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: /Choose photos for Work e/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Select all/ })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Choose photos for Work d, 0 of 1 selected" }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/visit-share/[visitId]/photos",
    params: { visitId: "visit", saveId: "d" },
  });
});

it("saves a dragged order and offers Move earlier and Move later as its accessible alternative", async () => {
  mockVisit.works = ["a", "b", "c"].map((id) => ({
    localId: id,
    title: `Work ${id}`,
    artist: "",
    cropPath: null,
  })) as VisitSummary["works"];
  mockSharing.draft = { ...mockSharing.draft!, saveLocalIds: ["a", "b", "c"] };
  await render(<VisitShareLayout />);
  const { data, onDragEnd } = mockGrid.mock.lastCall![0];
  await act(() => onDragEnd({ data: [data[2], data[0], data[1]] }));
  expect(mockController.edit).toHaveBeenLastCalledWith({ saveLocalIds: ["c", "a", "b"] });
  const workC = screen.getByRole("checkbox", { name: "Share Work c" });
  await fireEvent(workC, "accessibilityAction", { nativeEvent: { actionName: "moveEarlier" } });
  expect(mockController.edit).toHaveBeenLastCalledWith({ saveLocalIds: ["a", "c", "b"] });
  await fireEvent(screen.getByRole("checkbox", { name: "Share Work a" }), "accessibilityAction", {
    nativeEvent: { actionName: "moveEarlier" },
  });
  expect(mockController.edit).toHaveBeenCalledTimes(2);
});

it("keeps a left-out artwork in its place and includes it there again", async () => {
  mockVisit.works = ["a", "b", "c"].map((id) => ({
    localId: id,
    title: `Work ${id}`,
    artist: "",
    cropPath: null,
  })) as VisitSummary["works"];
  mockSharing.draft = { ...mockSharing.draft!, saveLocalIds: ["a", "b", "c"] };
  const view = await render(<VisitShareLayout />);
  await fireEvent.press(screen.getByRole("checkbox", { name: "Share Work b", checked: true }));
  expect(mockController.edit).toHaveBeenLastCalledWith({ saveLocalIds: ["a", "c"] });
  expect(playToggleHaptic).toHaveBeenLastCalledWith(false);
  mockSharing.draft = { ...mockSharing.draft, saveLocalIds: ["a", "c"] };
  await view.rerender(<VisitShareLayout />);
  const grid = mockGrid.mock.lastCall![0].data.map((work: { localId: string }) => work.localId);
  expect(grid).toEqual(["a", "b", "c"]);
  expect(screen.getByRole("checkbox", { name: "Share Work c", value: { text: "2" } })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("checkbox", { name: "Share Work b", checked: false }));
  expect(mockController.edit).toHaveBeenLastCalledWith({ saveLocalIds: ["a", "b", "c"] });
  expect(playToggleHaptic).toHaveBeenLastCalledWith(true);
});

it("chooses an artwork's shared photos on its own screen, all at once or one by one, without captions", async () => {
  mockPage = "photos";
  const photo = { owner: "account:a", savedLocalId: "save", visitLocalId: "visit", deletedAt: null, caption: "Mine" };
  mockPhotos = [
    { ...photo, localId: "full", path: "full.jpg", kind: "full" },
    { ...photo, localId: "label", path: "label.jpg", kind: "label" },
  ] as ArtworkPhoto[];
  mockVisit.works[0].owner = "account:a";
  mockSharing.draft = { ...mockSharing.draft!, photoSelections: [{ saveLocalId: "save", photoLocalIds: ["full"] }] };
  const view = await render(<VisitShareLayout />);
  expect(screen.getByRole("header", { name: "Water Lilies" })).toBeOnTheScreen();
  expect(screen.getByText("1 of 2 photos selected")).toBeOnTheScreen();
  expect(screen.queryByText("Full artwork")).toBeNull();
  expect(screen.queryByText("Mine")).toBeNull();
  expect(screen.queryByText(/stay private/)).toBeNull();
  expect(screen.queryByRole("button", { name: /Done/ })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Select all" }));
  expect(mockController.edit).toHaveBeenLastCalledWith({
    photoSelections: [{ saveLocalId: "save", photoLocalIds: ["full", "label"] }],
  });
  await fireEvent.press(screen.getByRole("checkbox", { name: "Share full artwork photo", checked: true }));
  expect(mockController.edit).toHaveBeenLastCalledWith({ photoSelections: [] });
  expect(playToggleHaptic).toHaveBeenCalledTimes(1);
  expect(playToggleHaptic).toHaveBeenLastCalledWith(false);
  mockSharing.draft = {
    ...mockSharing.draft,
    photoSelections: [{ saveLocalId: "save", photoLocalIds: ["full", "label"] }],
  };
  await view.rerender(<VisitShareLayout />);
  await fireEvent.press(screen.getByRole("button", { name: "Deselect all" }));
  expect(mockController.edit).toHaveBeenLastCalledWith({ photoSelections: [] });
});

it("reuses profile and sign-in entry points before offering sharing", async () => {
  mockSharing.profileRequired = true;
  const view = await render(<VisitShareLayout />);
  expect(screen.getByRole("button", { name: "Create profile" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeOnTheScreen();
  mockVisit.owner = "device:guest";
  await view.rerender(<VisitShareLayout />);
  await waitFor(() => expect(screen.queryByLabelText("Notes")).toBeNull());
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: "/sign-in",
    params: { context: "visit", visitId: "visit" },
  });
});

it("carries the wrap-up's Friends choice into the draft and through guest sign-in without changing visibility", async () => {
  mockAudience = "friends";
  mockVisit.visibility = "private";
  const view = await render(<VisitShareLayout />);
  expect(mockUseSharing).toHaveBeenCalledWith("visit", ["save"], "friends");
  expect(mockPatchVisit).not.toHaveBeenCalled();
  expect(mockController.publish).not.toHaveBeenCalled();
  mockVisit.owner = "device:guest";
  await view.rerender(<VisitShareLayout />);
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: "/sign-in",
    params: { context: "visit", visitId: "visit", audience: "friends" },
  });
});

it("styles the wallpaper row with the wall's picker, holding Post until Done", async () => {
  await render(<VisitShareLayout />);
  expect(screen.queryByRole("header", { name: "Wallpaper" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Style wallpaper" }));
  expect(screen.getByRole("header", { name: "Wallpaper" })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Style wallpaper" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Post" })).toBeNull();
  expect(screen.getByRole("button", { name: "Sage", selected: true })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Forest" }));
  expect(mockController.edit).toHaveBeenLastCalledWith({ color: "#45524B", pattern: "stripe" });
  await fireEvent.press(screen.getByRole("button", { name: "Dots" }));
  expect(mockController.edit).toHaveBeenLastCalledWith({ color: "#CDD0CA", pattern: "dots" });
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("header", { name: "Wallpaper" })).toBeNull();
  expect(screen.getByRole("button", { name: "Post" })).toBeOnTheScreen();
  expect(mockController.publish).not.toHaveBeenCalled();
});

it("offers Private, Friends, and Public in the form without posting", async () => {
  await render(<VisitShareLayout />);
  expect(screen.getByRole("button", { name: "Public", selected: true })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Friends" }));
  expect(mockController.edit).toHaveBeenCalledWith({ audience: "friends" });
  await fireEvent.press(screen.getByRole("button", { name: "Private" }));
  expect(mockController.edit).toHaveBeenCalledWith({ audience: "private" });
  expect(mockController.publish).not.toHaveBeenCalled();
});

it.each([
  ["private", "public"],
  ["public", "friends"],
] as const)("suggests mentions for the draft's %s → %s audience change", async (saved, chosen) => {
  mockVisit.visibility = saved;
  mockSharing.draft = { ...mockSharing.draft!, audience: chosen };
  await render(<VisitShareLayout />);
  const input = screen.getByLabelText("Notes");
  await fireEvent.changeText(input, "@maya");
  await fireEvent(input, "selectionChange", { nativeEvent: { selection: { start: 5, end: 5 } } });
  expect(mockMentionQuery).toHaveBeenLastCalledWith({
    query: "maya",
    place: { kind: "visit", audience: chosen, companionIds: [] },
  });
});

it("posts with the chosen audience, restores the visit's visibility when posting fails, and returns Home on success", async () => {
  mockPatchVisit.mockResolvedValue(undefined);
  mockSharing.draft = { ...mockSharing.draft!, audience: "friends" };
  mockController.publish.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await render(<VisitShareLayout />);
  expect(screen.getByLabelText("Notes")).toHaveTextContent("PRIVATE REFLECTION");
  expect(screen.queryByRole("button", { name: /Edit note|Save note/ })).toBeNull();
  await fireEvent.changeText(screen.getByLabelText("Notes"), "Stayed for the blue.");
  expect(mockPatchVisit).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Post" }));
  expect(mockPatchVisit.mock.calls).toEqual([
    ["visit", { reflection: "Stayed for the blue." }, "account:a", { sync: true }],
    ["visit", { visibility: "friends" }, "account:a"],
    ["visit", { visibility: "public" }, "account:a"],
  ]);
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(playErrorHaptic).toHaveBeenCalledTimes(1);
  expect(playSuccessHaptic).not.toHaveBeenCalled();
  mockPatchVisit.mockClear();
  await fireEvent.press(screen.getByRole("button", { name: "Post" }));
  expect(mockPatchVisit.mock.calls).toEqual([["visit", { visibility: "friends" }, "account:a"]]);
  expect(playSuccessHaptic).toHaveBeenCalledTimes(1);
  expect(mockToast).toHaveBeenCalledWith("Shared with friends.");
  expect(mockOfferNotifications).toHaveBeenCalledTimes(1);
  expect(mockDismissAll).toHaveBeenCalledTimes(1);
  expect(mockNavigate).toHaveBeenCalledWith({
    pathname: "/",
    params: { feed: "friends", posted: expect.any(String) },
  });
});

it("updates an already shared visit and posts a private visit without changing its visibility", async () => {
  mockVisit.visibility = "private";
  mockSharing.draft = { ...mockSharing.draft!, audience: "private" };
  mockSharing.acknowledged = { ...mockSharing.acknowledged!, status: "active", postId: "post" as never };
  mockController.publish.mockResolvedValueOnce(true);
  await render(<VisitShareLayout />);
  await fireEvent.press(screen.getByRole("button", { name: "Update" }));
  expect(mockPatchVisit).not.toHaveBeenCalled();
  expect(mockController.publish).toHaveBeenCalledTimes(1);
  expect(mockToast).toHaveBeenCalledWith("Visit posted. Only you can see it.");
  expect(mockOfferNotifications).not.toHaveBeenCalled();
  expect(mockNavigate).toHaveBeenCalledWith({
    pathname: "/",
    params: { feed: "friends", posted: expect.any(String) },
  });
});

/** Answers each alert with the named button, in order. */
function answerAlerts(...choices: string[]) {
  return jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons?: AlertButton[]) => {
    const choice = choices.shift();
    buttons?.find((button) => button.text === choice)?.onPress?.();
  });
}

it("asks before posting a note without safety checks, and can post the visit while the note stays private", async () => {
  mockSafetyChecks = false;
  const alert = answerAlerts("Post Without Note");
  mockController.publish.mockResolvedValueOnce(true);
  await render(<VisitShareLayout />);
  await fireEvent.press(screen.getByRole("button", { name: "Post" }));
  await waitFor(() => expect(mockController.publish).toHaveBeenCalledWith({ withoutReflection: true }));
  expect(alert).toHaveBeenCalledWith(
    "Post without your note?",
    "Visit notes need safety checks before they can be posted.",
    expect.any(Array),
    expect.anything(),
  );
  expect(mockSetSafetyChecks).not.toHaveBeenCalled();
});

it("turns safety checks on from the note question after naming who checks the text, then posts the note", async () => {
  mockSafetyChecks = false;
  const alert = answerAlerts("Turn On Checks", "Turn On");
  mockSetSafetyChecks.mockResolvedValueOnce(true);
  mockController.publish.mockResolvedValueOnce(true);
  await render(<VisitShareLayout />);
  await fireEvent.press(screen.getByRole("button", { name: "Post" }));
  await waitFor(() => expect(mockController.publish).toHaveBeenCalledWith({ withoutReflection: false }));
  expect(alert).toHaveBeenLastCalledWith(
    "Turn on safety checks?",
    expect.stringContaining("Our moderation provider, OpenAI,"),
    expect.any(Array),
    expect.anything(),
  );
  expect(mockSetSafetyChecks).toHaveBeenCalledWith({ enabled: true });
});

it("keeps the form when the note question is cancelled", async () => {
  mockSafetyChecks = false;
  answerAlerts("Cancel");
  await render(<VisitShareLayout />);
  await fireEvent.press(screen.getByRole("button", { name: "Post" }));
  await act(async () => {});
  expect(mockController.publish).not.toHaveBeenCalled();
  expect(mockPatchVisit).not.toHaveBeenCalled();
});

it("holds the Post slot with a busy indicator and disables Cancel until posting settles", async () => {
  let settle!: (posted: boolean) => void;
  mockController.publish.mockReturnValueOnce(new Promise<boolean>((resolve) => (settle = resolve)));
  await render(<VisitShareLayout />);
  await fireEvent.press(screen.getByRole("button", { name: "Post" }));
  expect(screen.getByRole("progressbar", { name: "Posting", busy: true })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Post" })).toBeNull();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await act(async () => settle(false));
  expect(screen.queryByRole("progressbar", { name: "Posting" })).toBeNull();
  expect(screen.getByRole("button", { name: "Post" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
});

it("keeps the form when posting throws and lets the person cancel out", async () => {
  mockPatchVisit.mockRejectedValueOnce(new Error("Storage unavailable"));
  mockSharing.draft = { ...mockSharing.draft!, audience: "friends" };
  await render(<VisitShareLayout />);
  await fireEvent.press(screen.getByRole("button", { name: "Post" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/could not be posted/);
  expect(playErrorHaptic).toHaveBeenCalledTimes(1);
  expect(mockNavigate).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(mockDismiss).toHaveBeenCalledTimes(1);
});

it("names who came along and opens the friends picker from Went with", async () => {
  mockSharing.draft!.companionIds = ["maya", "jonah"] as never;
  await render(<VisitShareLayout />);

  const row = screen.getByRole("button", { name: "Went with Maya Chen and Jonah Park" });
  await fireEvent.press(row);

  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/visit-share/[visitId]/companions",
    params: { visitId: "visit" },
  });
});

it("keeps a companion from the published post who is missing from the friend list", async () => {
  mockFriends = [];
  mockSharing.acknowledged!.companions = [mockFriend("maya", "Maya Chen", "maya")] as never;
  mockSharing.draft!.companionIds = ["maya"] as never;
  await render(<VisitShareLayout />);

  expect(screen.getByRole("button", { name: "Went with Maya Chen" })).toBeOnTheScreen();
});

it("picks friends who came along into the draft, up to ten", async () => {
  mockPage = "companions";
  mockSharing.draft!.companionIds = ["jonah"] as never;
  await render(<VisitShareLayout />);

  expect(screen.getByRole("checkbox", { name: "Jonah Park" })).toBeChecked();
  await fireEvent.press(screen.getByRole("checkbox", { name: "Maya Chen" }));
  expect(mockController.edit).toHaveBeenLastCalledWith({ companionIds: ["jonah", "maya"] });
  expect(playToggleHaptic).toHaveBeenLastCalledWith(true);
  await fireEvent.press(screen.getByRole("checkbox", { name: "Jonah Park" }));
  expect(mockController.edit).toHaveBeenLastCalledWith({ companionIds: [] });
  expect(playToggleHaptic).toHaveBeenLastCalledWith(false);

  mockFriends = Array.from({ length: 11 }, (_, index) => mockFriend(`f${index}`, `Friend ${index}`, `f${index}`));
  mockSharing.draft!.companionIds = mockFriends.slice(1).map((friend) => friend.profileId) as never;
  await screen.rerender(<VisitShareLayout />);
  expect(screen.getByRole("checkbox", { name: "Friend 0" })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "Friend 1" })).toBeEnabled();
  expect(screen.getByText("You can add up to 10 people.")).toBeOnTheScreen();
});

it("offers Find friends when there is no one to pick", async () => {
  mockPage = "companions";
  mockFriends = [];
  await render(<VisitShareLayout />);

  await fireEvent.press(screen.getByRole("button", { name: "Find friends" }));
  expect(mockPush).toHaveBeenCalledWith("/people");
});
