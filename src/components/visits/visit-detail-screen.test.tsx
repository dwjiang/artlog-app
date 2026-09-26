import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import { Stack } from "expo-router/stack";
import { renderRouter } from "expo-router/testing-library";
import { Alert, DeviceEventEmitter, Text } from "react-native";

import * as visits from "@/db/repos/visits";
import { switchOwner } from "@/lib/account/owner-store";
import type { VisitSummary } from "@/lib/journal/visit-summaries";

import { VisitBar } from "./visit-bar";
import { VisitDetailScreen } from "./visit-detail-screen";

jest.mock("expo-router", () => {
  const actual = jest.requireActual("expo-router");
  const React = jest.requireActual("react");
  const { View, Text, Pressable } = jest.requireActual("react-native");
  const MenuAction = ({
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
    ...actual,
    Stack: Object.assign((props: object) => React.createElement(actual.Stack, props), actual.Stack, {
      Toolbar: Object.assign(View, { Menu: View, MenuAction }),
    }),
  };
});
const mockCopy = jest.fn();
jest.mock("expo-clipboard", () => ({
  setStringAsync: (...args: unknown[]) => mockCopy(...args),
}));
/** Chooses a visibility and accepts the confirmation a published visit asks for. */
async function chooseVisibility(label: "Private" | "Friends" | "Public") {
  jest.mocked(Alert.alert).mockClear();
  await fireEvent.press(screen.getByRole("checkbox", { name: label }));
  const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2];
  await act(() => buttons?.find((button) => button.style !== "cancel")?.onPress?.());
}
const chip = (label: "Private" | "Friends" | "Public") => screen.getByRole("checkbox", { name: label, checked: true });
const mockVisit = {
  visibility: "public",
  syncedAt: null,
  localId: "visit",
  owner: "device:test-installation",
  venueId: "museum",
  venueName: "Museum",
  visitedOn: "2024-02-29",
  timeZone: "America/New_York",
  location: "New York",
  reflection: "The afternoon light",
  startedAt: 1,
  endedAt: 5,
  works: [
    {
      localId: "painting",
      title: "Water Lilies",
      artist: "Claude Monet",
      cropPath: null,
    },
  ],
} as VisitSummary;
const mockEnd = jest.fn();
const mockMove = jest.fn();
let mockOpenVisit: { localId: string } | undefined;
jest.mock("@/lib/venue/use-venue", () => ({
  useVenue: () => ({
    end: mockEnd,
    move: mockMove,
    visit: mockOpenVisit ? { ...mockVisit, ...mockOpenVisit } : undefined,
  }),
}));
jest.mock("@/lib/journal/use-visit-works", () => ({
  useVisitWorks: () => ({ works: mockVisit.works, loading: false }),
}));
const mockToast = jest.fn();
jest.mock("@/lib/ui/toast", () => ({
  ...jest.requireActual("@/lib/ui/toast"),
  showToast: (...args: unknown[]) => mockToast(...args),
}));
const mockLoad = jest.fn();
const mockFlush = jest.fn();
jest.mock("@/lib/account/collection-sync", () => ({
  flushJournal: () => mockFlush(),
}));
let mockSharingBusy = false;
let mockSharingError: string | undefined;
let mockProfileRequired = false;
let mockPublication: { status: string; audience: "private" | "friends" | "public"; postId: string | null } | null =
  null;
const published = (audience: "private" | "friends" | "public") => ({ status: "active", audience, postId: "post" });
const unposted = (audience: "private" | "friends" | "public") => ({ status: "private", audience, postId: null });
jest.mock("@/lib/journal/use-visits", () => ({
  useVisits: () => ({
    owner: mockVisit.owner,
    visits: [mockVisit],
    loading: false,
  }),
}));
jest.mock("@/lib/visits/use-visit-sharing", () => ({
  useVisitSharing: () => ({
    controller: { load: mockLoad },
    token: null,
    acknowledged: mockPublication,
    busy: mockSharingBusy,
    error: mockSharingError,
    profileRequired: mockProfileRequired,
  }),
}));
jest.mock("@/components/loading-ring", () => ({ LoadingRing: () => null }));
jest.mock("@/components/collection/saved-work-image", () => ({
  SavedWorkImage: () => null,
}));
const mockMarkSeen = jest.fn();
jest.mock("@/lib/journal/visit-seen", () => ({
  markVisitSeen: (...args: unknown[]) => mockMarkSeen(...args),
}));

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});
beforeEach(() => {
  mockSharingBusy = false;
  mockSharingError = undefined;
  mockProfileRequired = false;
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  mockVisit.works = [
    {
      localId: "painting",
      title: "Water Lilies",
      artist: "Claude Monet",
      cropPath: null,
    },
  ] as VisitSummary["works"];
  mockPublication = null;
  mockVisit.owner = "device:test-installation";
  mockVisit.endedAt = 5;
  mockVisit.visibility = "public";
  mockVisit.syncedAt = null;
  mockEnd.mockReset().mockResolvedValue(undefined);
  mockMove.mockReset().mockResolvedValue(undefined);
  mockOpenVisit = undefined;
  mockToast.mockClear();
  mockLoad.mockClear();
  mockCopy.mockReset();
  mockFlush.mockReset().mockResolvedValue(undefined);
  switchOwner(mockVisit.owner);
});

it("opens sign-in directly above a guest visit and preserves the visit when dismissed", async () => {
  const navigation = renderRouter(
    {
      _layout: () => <Stack />,
      "journal/[visitId]": VisitDetailScreen,
      "sign-in": () => <Text>Sign in to share this visit</Text>,
    },
    { initialUrl: "/journal/visit" },
  );
  await navigation;
  await fireEvent.press(screen.getByRole("button", { name: "Share visit" }));
  await waitFor(() => expect(navigation.getPathname()).toBe("/sign-in"));
  expect(navigation.getSearchParams()).toMatchObject({
    context: "visit",
    visitId: "visit",
  });
  await act(() => router.back());
  expect(navigation.getPathname()).toBe("/journal/visit");
  expect(screen.getByText("The afternoon light")).toBeOnTheScreen();
});

it("moves the visit to a picked date at its museum and opens the museum chooser from its name", async () => {
  const navigation = renderRouter(
    {
      _layout: () => <Stack />,
      "journal/[visitId]": VisitDetailScreen,
      "visit-museum": () => <Text>Change museum</Text>,
    },
    { initialUrl: "/journal/visit" },
  );
  await navigation;
  await fireEvent.changeText(screen.getByLabelText("Visit date"), "2024-02-20T12:00:00");
  await waitFor(() =>
    expect(mockMove).toHaveBeenCalledWith("visit", {
      venueId: "museum",
      venueName: "Museum",
      timeZone: "America/New_York",
      visitedOn: "2024-02-20",
    }),
  );
  mockMove.mockRejectedValueOnce(new Error("disk full"));
  await fireEvent.changeText(screen.getByLabelText("Visit date"), "2024-02-21T12:00:00");
  expect(await screen.findByRole("alert")).toHaveTextContent("The date could not be changed. Try again.");
  await fireEvent.press(screen.getByRole("button", { name: "Museum" }));
  await waitFor(() => expect(navigation.getPathname()).toBe("/visit-museum"));
  expect(navigation.getSearchParams()).toMatchObject({ visitId: "visit" });
});

it("shows a published visit's status and opens its post and link from the menu", async () => {
  mockVisit.owner = "account:test-account";
  mockPublication = published("public");
  mockCopy.mockResolvedValue(true);
  const navigation = renderRouter(
    {
      _layout: () => <Stack />,
      "journal/[visitId]": VisitDetailScreen,
      "visit/[postId]": () => <Text>Public post</Text>,
    },
    { initialUrl: "/journal/visit" },
  );
  await navigation;
  expect(chip("Public")).toBeOnTheScreen();
  expect(screen.getByText("Posted")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Edit post" })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: /Link artwork/ })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Copy link" }));
  expect(mockCopy).toHaveBeenCalledWith("artlog://visit/post");
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith("Visit link copied."));
  await fireEvent.press(screen.getByRole("button", { name: "View post" }));
  await waitFor(() => expect(navigation.getPathname()).toBe("/visit/post"));
  expect(screen.getByText("Public post")).toBeOnTheScreen();
});

it("hides the link for a private post and the share actions while a visit is being ended", async () => {
  mockVisit.owner = "account:test-account";
  mockVisit.visibility = "private";
  mockPublication = published("private");
  await renderRouter(
    { _layout: () => <Stack />, "journal/[visitId]": VisitDetailScreen },
    { initialUrl: "/journal/visit" },
  );
  expect(screen.getByRole("button", { name: "View post" })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Save & end visit" })).toBeNull();
});

it("opens saved artwork from a visit and returns to its private notes", async () => {
  const navigation = renderRouter(
    {
      _layout: () => <Stack />,
      "journal/[visitId]": VisitDetailScreen,
      "saved/[savedId]": () => <Text>Saved painting</Text>,
    },
    { initialUrl: "/journal/visit" },
  );
  await navigation;
  expect(screen.queryByText(/Private on this device/)).toBeNull();
  expect(screen.getByRole("button", { name: "Share visit" })).toBeOnTheScreen();
  expect(screen.getByText("The afternoon light")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("link", { name: "Water Lilies, Claude Monet" }));
  await waitFor(() => expect(navigation.getPathname()).toBe("/saved/painting"));
  expect(screen.getByText("Saved painting")).toBeOnTheScreen();
  await act(() => router.back());
  expect(navigation.getPathname()).toBe("/journal/visit");
  expect(screen.getByText("The afternoon light")).toBeOnTheScreen();
});

it("edits notes directly on the visit without navigating away or a save bar", async () => {
  const save = jest.spyOn(visits, "patchVisit").mockResolvedValue(undefined);
  const navigation = renderRouter(
    { _layout: () => <Stack />, "journal/[visitId]": VisitDetailScreen },
    { initialUrl: "/journal/visit" },
  );
  await navigation;
  expect(screen.getByRole("header", { name: "Notes" })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Save & end visit" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Edit note" }));
  expect(screen.queryByRole("button", { name: "Add a note" })).toBeNull();
  expect(navigation.getPathname()).toBe("/journal/visit");
  expect(screen.getByLabelText("Notes")).toHaveProp("value", "The afternoon light");
  expect(screen.getByRole("link", { name: "Water Lilies, Claude Monet" })).toBeOnTheScreen();
  expect(screen.getAllByRole("button", { name: "Save note" })).toHaveLength(1);
  await fireEvent.changeText(screen.getByLabelText("Notes"), "Latest private note");
  await fireEvent.press(screen.getByRole("button", { name: "Save note" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith("visit", { reflection: "Latest private note" }, mockVisit.owner, { sync: true }),
  );
  expect(screen.getByText("Latest private note")).toBeOnTheScreen();
  expect(mockEnd).not.toHaveBeenCalled();
});

it("saves the latest note when navigating to an artwork before autosave runs", async () => {
  const save = jest.spyOn(visits, "patchVisit").mockResolvedValue(undefined);
  const navigation = renderRouter(
    {
      _layout: () => <Stack />,
      "journal/[visitId]": VisitDetailScreen,
      "saved/[savedId]": () => <Text>Saved painting</Text>,
    },
    { initialUrl: "/journal/visit" },
  );
  await navigation;
  await fireEvent.press(screen.getByRole("button", { name: "Edit note" }));
  await fireEvent.changeText(screen.getByLabelText("Notes"), "A new memory");
  await fireEvent.press(screen.getByRole("link", { name: "Water Lilies, Claude Monet" }));
  await waitFor(() => expect(navigation.getPathname()).toBe("/saved/painting"));
  expect(save).toHaveBeenCalledWith("visit", { reflection: "A new memory" }, mockVisit.owner, {
    sync: true,
  });
});

it("shows all ten artworks and restores them after searching by artist", async () => {
  mockVisit.works = [
    ...mockVisit.works,
    ...Array.from({ length: 9 }, (_, i) => ({
      ...mockVisit.works[0],
      localId: `extra-${i}`,
      title: `Other ${i}`,
      artist: "Other",
    })),
  ];
  await renderRouter(
    { _layout: () => <Stack />, "journal/[visitId]": VisitDetailScreen },
    { initialUrl: "/journal/visit" },
  );
  expect(screen.getByPlaceholderText("Search this visit")).toBeOnTheScreen();
  expect(screen.getByText("10 artworks")).toBeOnTheScreen();
  expect(screen.getAllByRole("link")).toHaveLength(10);
  expect(screen.queryByRole("button", { name: "Search visit artworks" })).toBeNull();
  await fireEvent.changeText(screen.getByLabelText("Search visit artworks"), "Monet");
  expect(screen.getByRole("link", { name: "Water Lilies, Claude Monet" })).toBeOnTheScreen();
  expect(screen.getAllByRole("link")).toHaveLength(1);
  await fireEvent.changeText(screen.getByLabelText("Search visit artworks"), "unmatched");
  expect(screen.queryByRole("link", { name: "Water Lilies, Claude Monet" })).toBeNull();
  expect(screen.getByText("No artworks found.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Clear search" }));
  expect(screen.getByRole("link", { name: "Water Lilies, Claude Monet" })).toBeOnTheScreen();
  expect(screen.getByLabelText("Search visit artworks")).toHaveProp("value", "");
  expect(screen.getByPlaceholderText("Search this visit")).toBeOnTheScreen();
  expect(screen.getAllByRole("link")).toHaveLength(10);
});

it("offers one Link artwork entry: the section header, or the empty state without artworks", async () => {
  const navigation = renderRouter(
    {
      _layout: () => <Stack />,
      "journal/[visitId]": VisitDetailScreen,
      "link-artwork": () => <Text>Link an artwork</Text>,
    },
    { initialUrl: "/journal/visit" },
  );
  await navigation;
  expect(screen.getAllByRole("button", { name: "Link artwork" })).toHaveLength(1);
  await fireEvent.press(screen.getByRole("button", { name: "Link artwork" }));
  await waitFor(() => expect(navigation.getPathname()).toBe("/link-artwork"));
  expect(navigation.getSearchParams()).toMatchObject({ visitId: "visit" });
  mockVisit.works = [];
  await renderRouter(
    { _layout: () => <Stack />, "journal/[visitId]": VisitDetailScreen },
    { initialUrl: "/journal/visit" },
  );
  expect(screen.getByText("No artworks linked to this visit.")).toBeOnTheScreen();
  expect(screen.getAllByRole("button", { name: "Link artwork" })).toHaveLength(1);
});

it("marks a closed visit as seen once it is opened, but not one still in progress", async () => {
  await renderRouter(
    { _layout: () => <Stack />, "journal/[visitId]": VisitDetailScreen },
    { initialUrl: "/journal/visit" },
  );
  expect(mockMarkSeen).toHaveBeenCalledWith("visit", "device:test-installation");
  mockMarkSeen.mockClear();
  mockVisit.endedAt = null;
  await renderRouter(
    { _layout: () => <Stack />, "journal/[visitId]": VisitDetailScreen },
    { initialUrl: "/journal/visit" },
  );
  expect(mockMarkSeen).not.toHaveBeenCalled();
});

it("defaults to Public before publishing and opens the share form from the menu", async () => {
  mockVisit.owner = "account:test-account";
  switchOwner(mockVisit.owner);
  mockPublication = unposted("public");
  const navigation = renderRouter(
    {
      _layout: () => <Stack />,
      "journal/[visitId]": VisitDetailScreen,
      "visit-share/[visitId]/index": () => <Text>Share form</Text>,
    },
    { initialUrl: "/journal/visit" },
  );
  await navigation;
  expect(chip("Public")).toBeOnTheScreen();
  expect(screen.getByText("Not posted yet")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Save & end visit" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Share visit" }));
  await waitFor(() => expect(navigation.getPathname()).toBe("/visit-share/visit"));
});

it("saves Private for a guest directly without opening sharing", async () => {
  const save = jest.spyOn(visits, "patchVisit").mockResolvedValue(undefined);
  const navigation = renderRouter(
    { _layout: () => <Stack />, "journal/[visitId]": VisitDetailScreen },
    { initialUrl: "/journal/visit" },
  );
  await navigation;
  await chooseVisibility("Private");
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(save).toHaveBeenCalledWith("visit", { visibility: "private" }, mockVisit.owner);
  expect(mockFlush).not.toHaveBeenCalled();
  expect(navigation.getPathname()).toBe("/journal/visit");
});

it("keeps a private visit readable without saving anything", async () => {
  mockVisit.visibility = "private";
  mockVisit.syncedAt = 1;
  const save = jest.spyOn(visits, "patchVisit").mockResolvedValue(undefined);
  await renderRouter(
    { _layout: () => <Stack />, "journal/[visitId]": VisitDetailScreen },
    { initialUrl: "/journal/visit" },
  );
  expect(chip("Private")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Save & end visit" })).toBeNull();
  expect(save).not.toHaveBeenCalled();
});

it("does not call a new unsynced private visit a pending privacy change", async () => {
  mockVisit.owner = "account:test-account";
  mockVisit.visibility = "private";
  mockVisit.syncedAt = null;
  mockPublication = unposted("private");
  await renderRouter(
    { _layout: () => <Stack />, "journal/[visitId]": VisitDetailScreen },
    { initialUrl: "/journal/visit" },
  );
  expect(chip("Private")).toBeOnTheScreen();
  expect(screen.getByText("Not posted yet")).toBeOnTheScreen();
  expect(screen.queryByText(/pending/i)).toBeNull();
});

it.each([
  ["while its sharing status loads", () => {}],
  ["when its sharing status could not load", () => (mockSharingError = "The request did not finish.")],
])("does not call a visit unposted %s", async (_, arrange) => {
  mockVisit.owner = "account:test-account";
  switchOwner(mockVisit.owner);
  arrange();
  await renderRouter(
    { _layout: () => <Stack />, "journal/[visitId]": VisitDetailScreen },
    { initialUrl: "/journal/visit" },
  );
  expect(chip("Public")).toBeOnTheScreen();
  expect(screen.queryByText("Not posted yet")).toBeNull();
  expect(screen.queryByText("Posted")).toBeNull();
});

it("does not claim a published visit is private while its privacy change is awaiting sync", async () => {
  mockVisit.owner = "account:test-account";
  mockVisit.visibility = "private";
  mockVisit.syncedAt = null;
  mockPublication = published("public");
  await renderRouter(
    { _layout: () => <Stack />, "journal/[visitId]": VisitDetailScreen },
    { initialUrl: "/journal/visit" },
  );
  expect(screen.getByText("Visibility change pending")).toBeOnTheScreen();
  expect(screen.queryByText("Posted")).toBeNull();
  expect(screen.queryByRole("button", { name: "Save & end visit" })).toBeNull();
});

it("offers a retry when a public visit’s shared version could not be checked", async () => {
  mockVisit.owner = "account:test-account";
  switchOwner(mockVisit.owner);
  mockSharingError = "The request did not finish. Your draft is kept. Check your connection and try again.";
  await renderRouter(
    { _layout: () => <Stack />, "journal/[visitId]": VisitDetailScreen },
    { initialUrl: "/journal/visit" },
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t check the shared version.");
  expect(screen.queryByText(/Your draft is kept/)).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
  expect(mockLoad).toHaveBeenCalledTimes(1);
});

it.each([
  ["a private visit", () => (mockVisit.visibility = "private")],
  ["an account without a profile", () => (mockProfileRequired = true)],
])("keeps a failed shared-version check quiet for %s", async (_, arrange) => {
  mockVisit.owner = "account:test-account";
  switchOwner(mockVisit.owner);
  mockSharingError = "Create a profile to continue.";
  arrange();
  await renderRouter(
    { _layout: () => <Stack />, "journal/[visitId]": VisitDetailScreen },
    { initialUrl: "/journal/visit" },
  );
  expect(screen.queryByRole("alert")).toBeNull();
});

it("makes a published visit Private without asking and syncs it before refreshing publication state", async () => {
  mockVisit.owner = "account:test-account";
  switchOwner(mockVisit.owner);
  mockPublication = published("public");
  const save = jest.spyOn(visits, "patchVisit").mockResolvedValue(undefined);
  await renderRouter(
    { _layout: () => <Stack />, "journal/[visitId]": VisitDetailScreen },
    { initialUrl: "/journal/visit" },
  );
  await chooseVisibility("Private");
  expect(Alert.alert).not.toHaveBeenCalled();
  await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(1));
  expect(save).toHaveBeenCalledWith("visit", { visibility: "private" }, mockVisit.owner);
  expect(mockFlush).toHaveBeenCalledTimes(1);
});

it("warns when a privacy change cannot sync and retries without toggling again", async () => {
  mockVisit.owner = "account:test-account";
  switchOwner(mockVisit.owner);
  const save = jest.spyOn(visits, "patchVisit").mockResolvedValue(undefined);
  mockFlush.mockRejectedValueOnce(new Error("Offline"));
  await renderRouter(
    { _layout: () => <Stack />, "journal/[visitId]": VisitDetailScreen },
    { initialUrl: "/journal/visit" },
  );
  await chooseVisibility("Private");
  expect(screen.getByRole("alert")).toHaveTextContent(/A published visit may keep its previous visibility\./);
  expect(screen.getByText("Visibility change pending")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Retry visibility" }));
  await waitFor(() => expect(mockFlush).toHaveBeenCalledTimes(2));
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls.map((call) => call[1])).toEqual([{ visibility: "private" }, { visibility: "private" }]);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("releases the visibility control if an offline sync never finishes", async () => {
  jest.useFakeTimers();
  mockVisit.owner = "account:test-account";
  switchOwner(mockVisit.owner);
  jest.spyOn(visits, "patchVisit").mockResolvedValue(undefined);
  mockFlush.mockReturnValueOnce(new Promise(() => {}));
  await renderRouter(
    { _layout: () => <Stack />, "journal/[visitId]": VisitDetailScreen },
    { initialUrl: "/journal/visit" },
  );
  await chooseVisibility("Private");
  expect(screen.getByRole("checkbox", { name: "Public" })).toBeDisabled();
  expect(screen.getByText("Updating…")).toBeOnTheScreen();
  await act(() => jest.advanceTimersByTime(30_000));
  expect(screen.getByRole("button", { name: "Retry visibility" })).toBeEnabled();
  expect(screen.getByRole("checkbox", { name: "Public" })).toBeEnabled();
});

it("waits for pending notes to save before opening sharing", async () => {
  mockVisit.owner = "account:test-account";
  switchOwner(mockVisit.owner);
  let finish!: () => void;
  const save = jest.spyOn(visits, "patchVisit").mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const navigation = renderRouter(
    {
      _layout: () => <Stack />,
      "journal/[visitId]": VisitDetailScreen,
      "visit-share/[visitId]/index": () => <Text>Share form</Text>,
    },
    { initialUrl: "/journal/visit" },
  );
  await navigation;
  await fireEvent.press(screen.getByRole("button", { name: "Edit note" }));
  await fireEvent.changeText(screen.getByLabelText("Notes"), "Remember the blue room");
  await fireEvent.press(screen.getByRole("button", { name: "Share visit" }));
  expect(navigation.getPathname()).toBe("/journal/visit");
  await act(async () => finish());
  await waitFor(() => expect(navigation.getPathname()).toBe("/visit-share/visit"));
  expect(save).toHaveBeenCalledWith("visit", { reflection: "Remember the blue room" }, mockVisit.owner, { sync: true });
});

it("offers only Save & end visit on the open visit, ending it in one step", async () => {
  mockVisit.endedAt = null;
  mockVisit.visibility = "private";
  mockOpenVisit = { localId: "visit" };
  await renderRouter(
    { _layout: () => <Stack />, index: () => <Text>Home</Text>, "journal/[visitId]": VisitDetailScreen },
    { initialUrl: "/journal/visit" },
  );
  expect(screen.queryByRole("button", { name: "Share visit" })).toBeNull();
  expect(chip("Private")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Save & end visit" }));
  await waitFor(() => expect(mockEnd).toHaveBeenCalledWith("visit"));
  expect(mockToast).toHaveBeenCalledWith("Visit saved.");
});

it("holds a visibility change on the open visit until Save & end visit, as the end review does", async () => {
  mockVisit.owner = "account:test-account";
  switchOwner(mockVisit.owner);
  mockVisit.endedAt = null;
  mockVisit.visibility = "private";
  mockOpenVisit = { localId: "visit" };
  const save = jest.spyOn(visits, "patchVisit").mockResolvedValue(undefined);
  const navigation = renderRouter(
    {
      _layout: () => <Stack />,
      "journal/[visitId]": VisitDetailScreen,
      "visit-share/[visitId]/index": () => <Text>Share form</Text>,
    },
    { initialUrl: "/journal/visit" },
  );
  await navigation;
  await chooseVisibility("Public");
  expect(chip("Public")).toBeOnTheScreen();
  expect(save).not.toHaveBeenCalled();
  expect(mockFlush).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Save & end visit" }));
  await waitFor(() => expect(navigation.getPathname()).toBe("/visit-share/visit"));
  expect(save).toHaveBeenCalledWith("visit", { visibility: "public" }, "account:test-account");
  expect(mockEnd).toHaveBeenCalledWith("visit");
});

async function openEndReview() {
  mockOpenVisit = { localId: mockVisit.localId };
  const navigation = renderRouter({
    _layout: () => <Stack />,
    index: VisitBar,
    "journal/[visitId]": VisitDetailScreen,
    "visit-share/[visitId]/index": () => <Text>Share form</Text>,
    "sign-in": () => <Text>Sign in to share this visit</Text>,
  });
  await navigation;
  await fireEvent.press(screen.getByRole("button", { name: "Done?" }));
  return { navigation };
}

it("hides the end-visit Save while the keyboard is up and restores it after the keyboard closes", async () => {
  mockVisit.endedAt = null;
  await openEndReview();
  expect(screen.getByRole("button", { name: "Save & end visit" })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Share visit" })).toBeNull();
  const keyboard = {
    duration: 250,
    easing: "keyboard",
    endCoordinates: { screenX: 0, screenY: 500, width: 390, height: 300 },
  };
  await act(() => DeviceEventEmitter.emit("keyboardWillShow", keyboard));
  expect(screen.queryByRole("button", { name: "Save & end visit" })).toBeNull();
  expect(screen.getByLabelText("Notes")).toBeOnTheScreen();
  await act(() => DeviceEventEmitter.emit("keyboardDidHide", keyboard));
  expect(screen.getByRole("button", { name: "Save & end visit" })).toBeOnTheScreen();
  expect(chip("Public")).toBeOnTheScreen();
});

it("discards end-visit edits on Back and keeps the visit open", async () => {
  mockVisit.endedAt = null;
  const save = jest.spyOn(visits, "patchVisit").mockResolvedValue(undefined);
  const { navigation } = await openEndReview();
  await fireEvent.changeText(screen.getByLabelText("Notes"), "Not ready to finish");
  await fireEvent(screen.getByLabelText("Notes"), "blur");
  await chooseVisibility("Private");
  expect(chip("Private")).toBeOnTheScreen();
  await act(() => router.back());
  expect(navigation.getPathname()).toBe("/");
  expect(mockEnd).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Done?" }));
  expect(screen.getByLabelText("Notes")).toHaveProp("value", "The afternoon light");
  expect(chip("Public")).toBeOnTheScreen();
});

it.each(["device:test-installation", "account:test-account"])(
  "saves and ends a private visit for %s without opening sharing",
  async (owner) => {
    mockVisit.owner = owner;
    switchOwner(owner);
    mockVisit.endedAt = null;
    const save = jest.spyOn(visits, "patchVisit").mockResolvedValue(undefined);
    const { navigation } = await openEndReview();
    await fireEvent.changeText(screen.getByLabelText("Notes"), "A private memory");
    await chooseVisibility("Private");
    expect(save).not.toHaveBeenCalled();
    expect(mockEnd).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Save & end visit" }));
    await waitFor(() => expect(navigation.getPathname()).toBe("/"));
    expect(save).toHaveBeenCalledWith("visit", { reflection: "A private memory" }, owner, {
      sync: true,
    });
    expect(save).toHaveBeenCalledWith("visit", { visibility: "private" }, owner);
    expect(mockEnd).toHaveBeenCalledWith("visit");
    expect(mockToast).toHaveBeenCalledWith("Visit saved.");
  },
);

it("ends a public visit on Save before opening sharing", async () => {
  mockVisit.owner = "account:test-account";
  switchOwner(mockVisit.owner);
  mockVisit.endedAt = null;
  const { navigation } = await openEndReview();
  let finish!: () => void;
  mockEnd.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  await fireEvent.press(screen.getByRole("button", { name: "Save & end visit" }));
  expect(navigation.getPathname()).toBe("/journal/visit");
  expect(screen.getByRole("button", { name: "Save & end visit" })).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: "Save & end visit" }));
  expect(mockEnd).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  await waitFor(() => expect(navigation.getPathname()).toBe("/visit-share/visit"));
  await act(() => router.back());
  expect(navigation.getSearchParams().endVisit).toBeUndefined();
});

it("keeps a failed end-visit save open and allows retry", async () => {
  mockVisit.endedAt = null;
  mockVisit.visibility = "private";
  mockEnd.mockRejectedValueOnce(new Error("Storage unavailable"));
  const { navigation } = await openEndReview();
  await fireEvent.press(screen.getByRole("button", { name: "Save & end visit" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t save visit. Try again.");
  expect(navigation.getPathname()).toBe("/journal/visit");
  await fireEvent.press(screen.getByRole("button", { name: "Save & end visit" }));
  await waitFor(() => expect(navigation.getPathname()).toBe("/"));
  expect(mockEnd).toHaveBeenCalledTimes(2);
});

it("keeps the visit open when its note cannot save", async () => {
  mockVisit.endedAt = null;
  jest.spyOn(visits, "patchVisit").mockRejectedValueOnce(new Error("Storage unavailable"));
  const { navigation } = await openEndReview();
  await fireEvent.changeText(screen.getByLabelText("Notes"), "Keep this memory");
  await fireEvent.press(screen.getByRole("button", { name: "Save & end visit" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Your note could not be saved. Try again.");
  expect(mockEnd).not.toHaveBeenCalled();
  expect(navigation.getPathname()).toBe("/journal/visit");
  expect(screen.getByLabelText("Notes")).toHaveProp("value", "Keep this memory");
});

it("moves a published visit to Friends without asking and syncs it", async () => {
  mockVisit.owner = "account:test-account";
  switchOwner(mockVisit.owner);
  mockPublication = published("public");
  const save = jest.spyOn(visits, "patchVisit").mockResolvedValue(undefined);
  await renderRouter(
    { _layout: () => <Stack />, "journal/[visitId]": VisitDetailScreen },
    { initialUrl: "/journal/visit" },
  );
  await chooseVisibility("Friends");
  expect(Alert.alert).not.toHaveBeenCalled();
  await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(1));
  expect(save).toHaveBeenCalledWith("visit", { visibility: "friends" }, mockVisit.owner);
  expect(mockFlush).toHaveBeenCalledTimes(1);
});

it("asks before a published Friends visit becomes Public and keeps it on Cancel", async () => {
  mockVisit.owner = "account:test-account";
  switchOwner(mockVisit.owner);
  mockVisit.visibility = "friends";
  mockVisit.syncedAt = 1;
  mockPublication = published("friends");
  const save = jest.spyOn(visits, "patchVisit").mockResolvedValue(undefined);
  await renderRouter(
    { _layout: () => <Stack />, "journal/[visitId]": VisitDetailScreen },
    { initialUrl: "/journal/visit" },
  );
  expect(chip("Friends")).toBeOnTheScreen();
  expect(screen.getByText("Posted")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("checkbox", { name: "Public" }));
  const [title, , buttons] = jest.mocked(Alert.alert).mock.calls[0];
  expect(title).toBe("Make this visit public?");
  expect(save).not.toHaveBeenCalled();
  await act(() => buttons?.find((button) => button.text === "Make public")?.onPress?.());
  expect(save).toHaveBeenCalledWith("visit", { visibility: "public" }, mockVisit.owner);
});

it.each([
  ["Public", "Visibility change pending"],
  ["Friends", "Posted"],
] as const)("labels an unsynced Friends visit whose published version is %s", async (audience, label) => {
  mockVisit.owner = "account:test-account";
  mockVisit.visibility = "friends";
  mockPublication = published(audience === "Public" ? "public" : "friends");
  await renderRouter(
    { _layout: () => <Stack />, "journal/[visitId]": VisitDetailScreen },
    { initialUrl: "/journal/visit" },
  );
  expect(chip("Friends")).toBeOnTheScreen();
  expect(screen.getByText(label)).toBeOnTheScreen();
});

it("saves a Friends choice when ending a visit and then opens sharing", async () => {
  mockVisit.owner = "account:test-account";
  switchOwner(mockVisit.owner);
  mockVisit.endedAt = null;
  mockVisit.visibility = "private";
  const save = jest.spyOn(visits, "patchVisit").mockResolvedValue(undefined);
  const { navigation } = await openEndReview();
  await chooseVisibility("Friends");
  expect(save).not.toHaveBeenCalled();
  expect(chip("Friends")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Save & end visit" }));
  await waitFor(() => expect(navigation.getPathname()).toBe("/visit-share/visit"));
  expect(save).toHaveBeenCalledWith("visit", { visibility: "friends" }, mockVisit.owner);
  expect(mockEnd).toHaveBeenCalledWith("visit");
});

it("asks before a published Private visit is shown to friends", async () => {
  mockVisit.owner = "account:test-account";
  switchOwner(mockVisit.owner);
  mockVisit.visibility = "private";
  mockVisit.syncedAt = 1;
  mockPublication = published("private");
  const save = jest.spyOn(visits, "patchVisit").mockResolvedValue(undefined);
  await renderRouter(
    { _layout: () => <Stack />, "journal/[visitId]": VisitDetailScreen },
    { initialUrl: "/journal/visit" },
  );
  await fireEvent.press(screen.getByRole("checkbox", { name: "Friends" }));
  expect(jest.mocked(Alert.alert).mock.calls[0][0]).toBe("Share this visit with friends?");
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "View post" })).toBeOnTheScreen();
});
