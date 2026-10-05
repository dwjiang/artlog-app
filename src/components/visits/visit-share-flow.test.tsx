import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import type { ArtworkPhoto } from "@/db/schema";
import type { VisitSummary } from "@/lib/journal/visit-summaries";
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
jest.mock("@/lib/ui/toast", () => ({
  showToast: (...args: unknown[]) => mockToast(...args),
}));
jest.mock("@/lib/notifications/offer", () => ({ offerNotifications: () => mockOfferNotifications() }));
let mockPage: "index" | "photos" = "index";
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
        return React.createElement(mockPage === "photos" ? screens.VisitSharePhotosScreen : screens.VisitShareScreen);
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
  mockPage = "index";
  mockAudience = undefined;
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
    },
    draft: {
      audience: "public",
      visitLocalId: "visit",
      revision: 0,
      saveLocalIds: ["save"],
      reflection: "",
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

it("uses the explicitly selected visit photo in the feed preview, including an explicitly selected label", async () => {
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
  expect(screen.getByText("Water Lilies: selected-label.jpg")).toBeOnTheScreen();
  mockSharing.draft!.photoSelections = [];
  await view.rerender(<VisitShareLayout />);
  expect(screen.queryByText("Water Lilies: selected-label.jpg")).toBeNull();
  expect(screen.getByText("Water Lilies: no selected photo")).toBeOnTheScreen();
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
  expect(screen.getByText("Water Lilies: no selected photo")).toBeOnTheScreen();
  expect(screen.queryByText("Water Lilies: must-stay-private.jpg")).toBeNull();
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
  onDragEnd({ data: [data[2], data[0], data[1]] });
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
  mockSharing.draft = { ...mockSharing.draft, saveLocalIds: ["a", "c"] };
  await view.rerender(<VisitShareLayout />);
  const grid = mockGrid.mock.lastCall![0].data.map((work: { localId: string }) => work.localId);
  expect(grid).toEqual(["a", "b", "c"]);
  expect(screen.getByRole("checkbox", { name: "Share Work c", value: { text: "2" } })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("checkbox", { name: "Share Work b", checked: false }));
  expect(mockController.edit).toHaveBeenLastCalledWith({ saveLocalIds: ["a", "b", "c"] });
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

it("offers Private, Friends, and Public in the form without posting", async () => {
  await render(<VisitShareLayout />);
  expect(screen.getByRole("button", { name: "Public", selected: true })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Friends" }));
  expect(mockController.edit).toHaveBeenCalledWith({ audience: "friends" });
  await fireEvent.press(screen.getByRole("button", { name: "Private" }));
  expect(mockController.edit).toHaveBeenCalledWith({ audience: "private" });
  expect(mockController.publish).not.toHaveBeenCalled();
});

it("posts with the chosen audience, restores the visit's visibility when posting fails, and returns Home on success", async () => {
  mockPatchVisit.mockResolvedValue(undefined);
  mockSharing.draft = { ...mockSharing.draft!, audience: "friends" };
  mockController.publish.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await render(<VisitShareLayout />);
  expect(screen.getByLabelText("Notes")).toHaveProp("value", "PRIVATE REFLECTION");
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
  mockPatchVisit.mockClear();
  await fireEvent.press(screen.getByRole("button", { name: "Post" }));
  expect(mockPatchVisit.mock.calls).toEqual([["visit", { visibility: "friends" }, "account:a"]]);
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
  expect(mockNavigate).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(mockDismiss).toHaveBeenCalledTimes(1);
});
