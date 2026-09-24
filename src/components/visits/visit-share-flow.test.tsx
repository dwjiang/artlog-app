import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { VisitSummary } from "@/lib/journal/visit-summaries";
import type { ArtworkPhoto } from "@/db/schema";
import { dismissToast } from "@/lib/ui/toast";
import type { useVisitSharing } from "@/lib/visits/use-visit-sharing";
import { VisitShareLayout } from "./visit-share-flow";
const mockPush = jest.fn(),
  mockBack = jest.fn(),
  mockDismiss = jest.fn(),
  mockReplace = jest.fn();
const mockController = {
  load: jest.fn(),
  edit: jest.fn(),
  preview: jest.fn(),
  publish: jest.fn(),
  view: jest.fn(),
};
const mockCopy = jest.fn(),
  mockPatchVisit = jest.fn();
jest.mock("expo-clipboard", () => ({
  setStringAsync: (...args: unknown[]) => mockCopy(...args),
}));
jest.mock("@/db/repos/visits", () => ({
  patchVisit: (...args: unknown[]) => mockPatchVisit(...args),
}));
let mockPage: "index" | "preview" | "shared" | "success" = "index";
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
  useVisitSharing: () => mockSharing,
}));
jest.mock("../social/profile-form", () => ({ ProfileForm: () => null }));
jest.mock("../settings/account-section", () => ({
  AccountSection: () => null,
}));
jest.mock("drizzle-orm/expo-sqlite", () => ({
  ...jest.requireActual("drizzle-orm/expo-sqlite"),
  useLiveQuery: () => ({ data: mockPhotos }),
}));
jest.mock("../collection/saved-work-image", () => ({
  SavedWorkImage: ({ title, path }: { title: string; path: string | null }) => {
    const { Text } = jest.requireActual("react-native");
    return (
      <Text>
        {title}: {path ?? "no selected photo"}
      </Text>
    );
  },
}));
jest.mock("../artwork/display-media", () => ({
  DisplayMedia: ({ label }: { label: string }) => {
    const { Text } = jest.requireActual("react-native");
    return <Text accessibilityRole="image">{label}</Text>;
  },
}));
jest.mock("expo-router", () => {
  const React = jest.requireActual("react");
  return {
    useRouter: () => ({ push: mockPush }),
    router: {
      push: (...args: unknown[]) => mockPush(...args),
      replace: (...args: unknown[]) => mockReplace(...args),
      back: () => mockBack(),
      dismiss: () => mockDismiss(),
    },
    useLocalSearchParams: () => ({ visitId: "visit" }),
    useSegments: () => ["visit-share", "[visitId]"],
    useNavigation: () => ({ getState: () => undefined }),
    Stack: Object.assign(
      () => {
        const screens = jest.requireActual("./visit-share-flow");
        return React.createElement(
          mockPage === "preview"
            ? screens.VisitSharePreviewScreen
            : mockPage === "shared"
              ? screens.VisitSharedScreen
              : mockPage === "success"
                ? screens.VisitShareSuccessScreen
                : screens.VisitShareScreen,
        );
      },
      {
        Screen: () => null,
        Toolbar: Object.assign(jest.requireActual("react-native").View, {
          View: jest.requireActual("react-native").View,
        }),
      },
    ),
  };
});
afterEach(() => dismissToast());
beforeEach(() => {
  jest.clearAllMocks();
  mockPage = "index";
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
    preview: null,
    shared: null,
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
it("includes visit notes and offers no separate shared-note editor", async () => {
  mockSharing.draft!.reflection = "A visit memory";
  await render(<VisitShareLayout />);
  expect(screen.queryByText("PRIVATE REFLECTION")).toBeNull();
  expect(screen.getByText("A visit memory")).toBeOnTheScreen();
  expect(screen.getByText("Your private artwork notes are not included.")).toBeOnTheScreen();
  expect(screen.queryByLabelText("Shared reflection")).toBeNull();
  await fireEvent.press(screen.getByRole("checkbox", { name: "Share Water Lilies" }));
  expect(mockController.edit).toHaveBeenCalledWith({ saveLocalIds: [] });
});
it("opens the native preview route only after a successful preview response", async () => {
  mockController.preview.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await render(<VisitShareLayout />);
  await fireEvent.press(screen.getByRole("button", { name: "Preview shared visit" }));
  expect(mockPush).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Preview shared visit" }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/visit-share/[visitId]/preview",
    params: { visitId: "visit" },
  });
});
it("includes the saved notes without a second writing field", async () => {
  mockSharing.draft!.reflection = "Remember the light";
  await render(<VisitShareLayout />);
  expect(screen.getByText("Remember the light")).toBeOnTheScreen();
  expect(screen.queryByLabelText("Shared reflection")).toBeNull();
  expect(mockController.publish).not.toHaveBeenCalled();
});
it("lets an artwork tile change the shared selection without changing the reflection", async () => {
  mockSharing.draft!.reflection = "A visit memory";
  await render(<VisitShareLayout />);
  const choice = screen.getByRole("checkbox", {
    name: "Share Water Lilies",
    checked: true,
  });
  await fireEvent.press(choice);
  expect(mockController.edit).toHaveBeenCalledWith({ saveLocalIds: [] });
  expect(screen.getByText("A visit memory")).toBeOnTheScreen();
  expect(screen.getByText("Your private artwork notes are not included.")).toBeOnTheScreen();
});
it("explains the highlight limit inside the sheet, where the root toast layer is covered", async () => {
  const works = ["a", "b", "c", "d"].map((id) => ({
    localId: id,
    title: `Work ${id}`,
    artist: "",
    cropPath: null,
  }));
  const view = await render(<VisitShareLayout />);
  mockVisit.works = works as VisitSummary["works"];
  mockSharing.draft = {
    ...mockSharing.draft!,
    saveLocalIds: ["a", "b", "c", "d"],
    highlightLocalIds: ["a", "b", "c"],
  };
  await view.rerender(<VisitShareLayout />);
  await fireEvent.press(screen.getByRole("button", { name: "Highlight Work d" }));
  expect(mockController.edit).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("Choose up to 3 highlights. Remove one to choose another.");
  await fireEvent.press(screen.getByRole("button", { name: "Remove highlight Work c" }));
  expect(mockController.edit).toHaveBeenCalledWith({
    highlightLocalIds: ["a", "b"],
  });
});
it("renders the server preview in published order and stays on it when publishing fails", async () => {
  mockPage = "preview";
  const media = { kind: "placeholder", width: 1, height: 1 } as const;
  mockSharing.draft = {
    ...mockSharing.draft!,
    saveLocalIds: ["save", "lead"],
    highlightLocalIds: ["lead"],
  };
  mockSharing.preview = {
    audience: "public",
    author: { name: "Reader", username: "reader" } as never,
    venue: { name: "Museum", venueId: "museum" as never },
    visitedOn: "2024-02-29",
    reflection: "Shared reflection only",
    artworks: [
      {
        saveLocalId: "save",
        artwork: { title: "Water Lilies", artist: "Monet", media },
        photos: [media],
      },
      {
        saveLocalId: "lead",
        artwork: { title: "Haystacks", artist: "Monet", media },
        photos: [media],
      },
    ],
  };
  mockController.publish.mockResolvedValue(false);
  await render(<VisitShareLayout />);
  await fireEvent(screen.getByTestId("visit-artworks"), "layout", {
    nativeEvent: { layout: { width: 350, height: 220, x: 0, y: 0 } },
  });
  expect(screen.getAllByRole("image").map((image) => image.props.children)).toEqual(["Haystacks", "Water Lilies"]);
  expect(screen.queryByText("PRIVATE REFLECTION")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Publish visit" }));
  expect(mockBack).not.toHaveBeenCalled();
});
it("offers a refreshed preview after revision conflicts", async () => {
  mockPage = "preview";
  mockSharing.conflict = true;
  mockSharing.error = "Refresh the preview.";
  await render(<VisitShareLayout />);
  expect(screen.queryByRole("button", { name: "Publish visit" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Back to selection" }));
  expect(mockBack).toHaveBeenCalled();
});
it("reuses profile and sign-in entry points before offering sharing", async () => {
  mockSharing.profileRequired = true;
  const view = await render(<VisitShareLayout />);
  expect(screen.getByRole("button", { name: "Create profile" })).toBeOnTheScreen();
  mockVisit.owner = "device:guest";
  await view.rerender(<VisitShareLayout />);
  await waitFor(() => expect(screen.queryByLabelText("Shared reflection")).toBeNull());
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: "/sign-in",
    params: { context: "visit", visitId: "visit" },
  });
});

it("publishes publicly without a Friends-only option", async () => {
  await render(<VisitShareLayout />);
  expect(screen.queryByRole("button", { name: "Friends" })).toBeNull();
  expect(screen.queryByLabelText("Who can see this visit")).toBeNull();
  expect(
    screen.getByText(
      "Only the selected photos and your visit notes will be published. Anyone can view a published visit.",
    ),
  ).toBeOnTheScreen();
  expect(mockController.publish).not.toHaveBeenCalled();
});

it("names the public audience before publishing and allows returning to selection", async () => {
  mockPage = "preview";
  mockSharing.preview = {
    audience: "public",
    author: { name: "Reader", username: "reader" } as never,
    venue: { name: "Museum", venueId: "museum" as never },
    visitedOn: "2024-02-29",
    reflection: "",
    artworks: [],
  };
  await render(<VisitShareLayout />);
  expect(screen.getByText("2 · Review your visit")).toBeOnTheScreen();
  expect(
    screen.getByText(
      "Publishing makes these selected photos and visit notes public, including to people without an account. Your other visits and artwork notes stay private.",
    ),
  ).toBeOnTheScreen();
  expect(mockController.publish).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Edit selection" }));
  expect(mockBack).toHaveBeenCalledTimes(1);
  mockController.publish.mockResolvedValueOnce(true);
  await fireEvent.press(screen.getByRole("button", { name: "Publish visit" }));
  expect(mockController.publish).toHaveBeenCalledTimes(1);
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: "/visit-share/[visitId]/success",
    params: { visitId: "visit" },
  });
});

it("shows the sign-in gate for a guest opening the shared-version route", async () => {
  mockPage = "shared";
  mockVisit.owner = "device:guest";
  await render(<VisitShareLayout />);
  expect(screen.getByRole("button", { name: "Sign in" })).toBeOnTheScreen();
  expect(screen.queryByText("Loading shared visit…")).toBeNull();
  expect(mockController.view).not.toHaveBeenCalled();
});

it("distinguishes a withdrawn share from loading and returns to selection", async () => {
  mockPage = "shared";
  await render(<VisitShareLayout />);
  expect(screen.getByText("This visit is not currently shared.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Back to selection" }));
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: "/visit-share/[visitId]",
    params: { visitId: "visit" },
  });
});

it("keeps shared-version errors retryable after loading ends", async () => {
  mockPage = "shared";
  mockSharing.acknowledged = null;
  mockSharing.error = "Check your connection and try again.";
  await render(<VisitShareLayout />);
  expect(screen.getByText("The shared visit could not load.")).toBeOnTheScreen();
  expect(screen.getByRole("alert")).toHaveTextContent("Check your connection and try again.");
  mockController.view.mockClear();
  await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
  expect(mockController.view).toHaveBeenCalledTimes(1);
});

it("makes a private visit public only for a successful publish and restores it when publishing fails", async () => {
  mockPage = "preview";
  mockVisit.visibility = "private";
  mockPatchVisit.mockResolvedValue(undefined);
  mockSharing.preview = {
    audience: "public",
    author: { name: "Reader", username: "reader" } as never,
    venue: { name: "Museum", venueId: "museum" as never },
    visitedOn: "2024-02-29",
    reflection: "",
    artworks: [],
  };
  mockController.publish.mockResolvedValueOnce(false);
  await render(<VisitShareLayout />);
  await fireEvent.press(screen.getByRole("button", { name: "Publish visit" }));
  expect(mockPatchVisit.mock.calls).toEqual([
    ["visit", { visibility: "public" }, "account:a"],
    ["visit", { visibility: "private" }, "account:a"],
  ]);
  expect(mockReplace).not.toHaveBeenCalled();
  mockPatchVisit.mockClear();
  mockController.publish.mockResolvedValueOnce(true);
  await fireEvent.press(screen.getByRole("button", { name: "Publish visit" }));
  expect(mockPatchVisit.mock.calls).toEqual([["visit", { visibility: "public" }, "account:a"]]);
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: "/visit-share/[visitId]/success",
    params: { visitId: "visit" },
  });
});

it("lets a private visit enter selection without publishing it", async () => {
  mockVisit.visibility = "private";
  await render(<VisitShareLayout />);
  expect(screen.getByRole("button", { name: "Preview shared visit" })).toBeOnTheScreen();
  expect(screen.getByRole("checkbox", { name: "Share Water Lilies" })).toBeOnTheScreen();
  expect(mockController.publish).not.toHaveBeenCalled();
});

it("shows success only for a published visit and copies its app link", async () => {
  mockPage = "success";
  mockCopy.mockResolvedValue(true);
  mockSharing.acknowledged = {
    ...mockSharing.acknowledged!,
    status: "active",
    postId: "published-post" as never,
    saveLocalIds: ["save"],
  };
  await render(<VisitShareLayout />);
  expect(screen.getByText("Your Museum visit is now public.")).toBeOnTheScreen();
  expect(screen.getByText(/· 1 artwork$/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Copy link" }));
  expect(mockCopy).toHaveBeenCalledWith("artlog://visit/published-post");
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  expect(mockDismiss).toHaveBeenCalledTimes(1);
});

it("shows the artworks it just published on the success screen after the controller clears its preview", async () => {
  mockPage = "preview";
  const media = { kind: "placeholder", width: 1, height: 1 } as const;
  mockSharing.draft = {
    ...mockSharing.draft!,
    saveLocalIds: ["save", "lead"],
    highlightLocalIds: ["lead"],
  };
  mockSharing.preview = {
    audience: "public",
    author: { name: "Reader", username: "reader" } as never,
    venue: { name: "Museum", venueId: "museum" as never },
    visitedOn: "2024-02-29",
    reflection: "",
    artworks: [
      {
        saveLocalId: "save",
        artwork: { title: "Water Lilies", artist: "Monet", media },
        photos: [media],
      },
      {
        saveLocalId: "lead",
        artwork: { title: "Haystacks", artist: "Monet", media },
        photos: [media],
      },
    ],
  };
  mockController.publish.mockResolvedValueOnce(true);
  const view = await render(<VisitShareLayout />);
  await fireEvent.press(screen.getByRole("button", { name: "Publish visit" }));
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: "/visit-share/[visitId]/success",
    params: { visitId: "visit" },
  });
  mockPage = "success";
  mockSharing.preview = null;
  mockSharing.acknowledged = {
    ...mockSharing.acknowledged!,
    status: "active",
    postId: "published-post" as never,
    saveLocalIds: ["save", "lead"],
  };
  await view.rerender(<VisitShareLayout />);
  await fireEvent(screen.getByTestId("visit-artworks"), "layout", {
    nativeEvent: { layout: { width: 350, height: 220, x: 0, y: 0 } },
  });
  expect(screen.getAllByRole("image").map((image) => image.props.children)).toEqual(["Haystacks", "Water Lilies"]);
  expect(screen.getByText(/· 2 artworks$/)).toBeOnTheScreen();
});

it("does not claim success when the success route opens before publication", async () => {
  mockPage = "success";
  await render(<VisitShareLayout />);
  expect(screen.getByText("This visit hasn’t been shared yet.")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
});
