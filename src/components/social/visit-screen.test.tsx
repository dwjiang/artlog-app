import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ConvexError } from "convex/values";
import { ActionSheetIOS } from "react-native";

import { Gallery } from "@/constants/theme";
import type { SharedArtwork, SharedVisit } from "@/lib/social/types";

import { VisitScreen } from "./visit-screen";

const mockPush = jest.fn();
const mockLoadMore = jest.fn();
const mockRefresh = jest.fn();
const mockArtworkRefresh = jest.fn();
const mockPages = jest.fn();
let mockVisit: { data?: SharedVisit; error?: Error };
const mockLeave = jest.fn();
jest.mock("convex/react", () => ({
  ...jest.requireActual("convex/react"),
  useMutation: (mutation: never) =>
    jest.requireActual("convex/server").getFunctionName(mutation) === "visitCompanions:leave" ? mockLeave : jest.fn(),
}));
const mockToast = jest.fn();
jest.mock("@/lib/ui/toast", () => ({
  showToast: (...args: unknown[]) => mockToast(...args),
  showErrorToast: (...args: unknown[]) => mockToast(...args),
}));
jest.mock("@/lib/social/use-social-session", () => ({
  useSocialSession: () => ({
    status: "ready",
    key: "viewer",
    token: "visit-token",
    profileId: "viewer",
    offline: false,
  }),
}));
jest.mock("@/lib/social/use-social-query", () => ({
  useCursorPages: (...args: unknown[]) => mockPages(...args),
  useSocialQuery: (query: never) =>
    jest.requireActual("convex/server").getFunctionName(query) === "sharedVisits:get"
      ? { ...mockVisit, refresh: mockRefresh }
      : { data: undefined, refresh: mockRefresh },
}));
jest.mock("@/lib/social/use-block", () => ({ useBlock: () => ({ block: jest.fn() }) }));
jest.mock("@/components/settings/account-section", () => ({
  AccountSection: () => null,
}));
jest.mock("expo-router", () => ({
  Stack: jest.requireActual("@/components/stack-toolbar-mock").mockStack,
  router: { push: (...args: unknown[]) => mockPush(...args), dismissAll: jest.fn(), navigate: jest.fn() },
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("expo-image", () => ({
  Image: (props: object) => {
    const { View } = jest.requireActual("react-native");
    return <View accessibilityRole="image" {...props} />;
  },
}));

const artwork = (id: string, title: string, artist = "Claude Monet"): SharedArtwork => ({
  itemId: id as never,
  artwork: {
    title,
    artist,
    media: {
      kind: "catalog",
      width: 300,
      height: 200,
      url: "https://museum.example/art.jpg",
      sourceUrl: "https://museum.example/art",
      rights: "public_domain",
    },
  },
});
const works = [
  artwork("a", "Water Lilies"),
  artwork("b", "The Dance", "Henri Matisse"),
  artwork("c", "Still Life", "Paul Cézanne"),
  artwork("d", "Haystacks"),
  artwork("e", "The Garden"),
];
const visit: SharedVisit = {
  audience: "public",
  postId: "post-a",
  author: {
    profileId: "alex" as never,
    name: "Alex Chen",
    username: "alex",
    avatar: "vermeer" as const,
    publishedWallCount: 0,
  },
  venue: { venueId: "museum" as never, name: "Musée d’Orsay", city: "Paris" },
  visitedOn: "2026-09-12",
  reflection: "The small details always win.",
  publishedAt: 1,
  revision: 1,
  artworkCount: 5,
  color: "#CDD0CA",
  companions: [],
  pattern: "stripe",
  artworks: { page: works.slice(0, 3), cursor: "more", isDone: false },
};
const pages = (patch: object = {}) => ({
  items: [],
  loading: false,
  refreshing: false,
  done: false,
  canLoadMore: false,
  loadMore: mockLoadMore,
  refresh: mockArtworkRefresh,
  ...patch,
});
const restArgs = () => mockPages.mock.calls.at(-1)?.[1];

beforeEach(() => {
  jest.clearAllMocks();
  mockVisit = { data: visit };
  mockPages.mockReturnValue(pages());
});

it("shows the shared visit as its feed card, opening each artwork and the author’s profile", async () => {
  await render(<VisitScreen postId="post-a" />);
  expect(screen.getByText("Musée d’Orsay · Paris")).toBeOnTheScreen();
  expect(screen.getByText("The small details always win.")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "View visit" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "View Still Life" }));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: "/artwork",
    params: { kind: "visit", postId: "post-a", itemId: "c" },
  });
  await fireEvent.press(screen.getByRole("button", { name: "View Alex Chen’s profile" }));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: "/profile/[profileId]",
    params: { profileId: "alex" },
  });
});

it("marks an artwork that has more than one shared photo", async () => {
  const photos = [1, 2, 3].map(() => works[0].artwork.media);
  mockVisit = {
    data: { ...visit, artworks: { ...visit.artworks, page: [{ ...works[0], photos }, works[1], works[2]] } },
  };
  await render(<VisitScreen postId="post-a" />);
  expect(screen.getByRole("button", { name: "View Water Lilies, 3 photos" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "View The Dance" })).toBeOnTheScreen();
});

it("labels artworks in ink that stays legible on light and dark wallpapers", async () => {
  const view = await render(<VisitScreen postId="post-a" />);
  expect(screen.getByText("Henri Matisse")).toHaveStyle({ color: Gallery.ink });
  mockVisit = { data: { ...visit, color: "#45524B", pattern: "trellis" } };
  await view.rerender(<VisitScreen postId="post-a" />);
  expect(screen.getByText("Henri Matisse")).toHaveStyle({ color: Gallery.paper });
});

it("loads the rest of the artworks at the end of the row without repeating the first ones", async () => {
  const view = await render(<VisitScreen postId="post-a" />);
  expect(restArgs()).toBe("skip");
  await fireEvent(screen.getByTestId("art-band"), "endReached");
  expect(restArgs()).toEqual({ postId: "post-a" });
  // A later page that only repeats the card's artworks keeps loading.
  mockPages.mockReturnValue(pages({ items: works.slice(0, 3), canLoadMore: true }));
  await view.rerender(<VisitScreen postId="post-a" />);
  expect(mockLoadMore).toHaveBeenCalled();
  mockPages.mockReturnValue(pages({ items: works, done: true }));
  await view.rerender(<VisitScreen postId="post-a" />);
  expect(screen.getAllByRole("button", { name: "View Water Lilies" })).toHaveLength(1);
  expect(screen.getByRole("button", { name: "View The Garden" })).toBeOnTheScreen();
});

it.each([0, 2])("loads remaining artworks when only %i original highlights survive", async (highlightCount) => {
  const remaining = works.slice(0, highlightCount + 2);
  mockVisit = {
    data: {
      ...visit,
      artworkCount: remaining.length,
      artworks: { page: remaining.slice(0, highlightCount), cursor: null, isDone: true },
    },
  };
  const view = await render(<VisitScreen postId="post-a" />);
  expect(restArgs()).toEqual(highlightCount > 0 ? "skip" : { postId: "post-a" });
  if (highlightCount > 0) {
    await fireEvent(screen.getByTestId("art-band"), "endReached");
  }
  expect(restArgs()).toEqual({ postId: "post-a" });
  mockPages.mockReturnValue(pages({ items: remaining, done: true }));
  await view.rerender(<VisitScreen postId="post-a" />);
  for (const item of remaining) {
    expect(screen.getAllByRole("button", { name: `View ${item.artwork.title}` })).toHaveLength(1);
  }
});

it("does not fetch more when the card already contains every artwork", async () => {
  mockVisit = {
    data: {
      ...visit,
      artworkCount: 3,
      artworks: { page: works.slice(0, 3), cursor: null, isDone: true },
    },
  };
  await render(<VisitScreen postId="post-a" />);
  await fireEvent(screen.getByTestId("art-band"), "endReached");
  expect(restArgs()).toBe("skip");
  expect(mockLoadMore).not.toHaveBeenCalled();
});

it.each([0, 4])("retries a failed artwork page while keeping %i loaded artworks visible", async (loadedCount) => {
  if (loadedCount === 0) {
    mockVisit = { data: { ...visit, artworks: { page: [], cursor: null, isDone: true } } };
  }
  const view = await render(<VisitScreen postId="post-a" />);
  if (loadedCount > 0) await fireEvent(screen.getByTestId("art-band"), "endReached");
  const items = works.slice(0, loadedCount);
  mockPages.mockReturnValue(pages({ items, error: new TypeError("Network request failed") }));
  await view.rerender(<VisitScreen postId="post-a" />);
  expect(screen.getByText(loadedCount ? "Couldn’t load more artworks." : "Couldn’t load artworks.")).toBeOnTheScreen();
  for (const item of items) {
    expect(screen.getByRole("button", { name: `View ${item.artwork.title}` })).toBeOnTheScreen();
  }
  await fireEvent.press(screen.getByRole("button", { name: loadedCount ? "Try loading more" : "Try again" }));
  expect(mockArtworkRefresh).toHaveBeenCalledTimes(1);
  expect(mockRefresh).not.toHaveBeenCalled();
  mockPages.mockReturnValue(pages({ items, loading: true, refreshing: true }));
  await view.rerender(<VisitScreen postId="post-a" />);
  expect(screen.getByLabelText("Loading more artworks")).toBeOnTheScreen();
  for (const item of items) {
    expect(screen.getByRole("button", { name: `View ${item.artwork.title}` })).toBeOnTheScreen();
  }
  mockPages.mockReturnValue(pages({ items: works, done: true }));
  await view.rerender(<VisitScreen postId="post-a" />);
  expect(screen.getByRole("button", { name: "View The Garden" })).toBeOnTheScreen();
  expect(screen.queryByText(/Couldn’t load.*artworks/)).toBeNull();
});

it("offers the author’s profile and reporting from the card menu, without a visit link", async () => {
  const sheet = jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementation((options, choose) => {
    choose(options.options.indexOf("Report visit"));
  });
  await render(<VisitScreen postId="post-a" />);
  await fireEvent.press(screen.getByRole("button", { name: "More options" }));
  expect(sheet.mock.calls[0][0].options).toEqual([
    "View Alex Chen’s profile",
    "Report visit",
    "Block Alex Chen",
    "Cancel",
  ]);
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/report", params: { kind: "sharedVisit", id: "post-a" } });
});

it("explains a revoked post and offers a retry for other failures", async () => {
  mockVisit = { error: new ConvexError({ code: "not_found" }) };
  const view = await render(<VisitScreen postId="post-a" />);
  expect(screen.getByText("Visit unavailable.")).toBeOnTheScreen();
  expect(screen.queryByText(visit.reflection)).toBeNull();
  mockVisit = { error: new Error("offline") };
  await view.rerender(<VisitScreen postId="post-a" />);
  await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
  expect(mockRefresh).toHaveBeenCalled();
});

const companion = (profileId: string, name: string) => ({
  profileId: profileId as never,
  name,
  username: profileId,
  avatar: "vermeer" as const,
  publishedWallCount: 0,
});

it("names the friends who came along, each opening their profile", async () => {
  mockVisit = {
    data: {
      ...visit,
      companions: [companion("maya", "Maya Chen"), companion("jonah", "Jonah Park"), companion("viewer", "Sam Lee")],
    },
  };
  await render(<VisitScreen postId="post-a" />);

  expect(screen.getByText(/with Maya Chen, Jonah Park, and Sam Lee/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("link", { name: "Jonah Park" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/profile/[profileId]", params: { profileId: "jonah" } });
});

it("lets a companion remove themselves from the visit", async () => {
  mockVisit = { data: { ...visit, companions: [companion("viewer", "Sam Lee")] } };
  mockLeave.mockResolvedValue(null);
  const sheet = jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementation((options, choose) => {
    choose(options.options.indexOf("Remove me from this visit"));
  });
  await render(<VisitScreen postId="post-a" />);

  await fireEvent.press(screen.getByRole("button", { name: "More options" }));

  expect(sheet.mock.calls[0][0].options).toEqual([
    "View Alex Chen’s profile",
    "Remove me from this visit",
    "Report visit",
    "Block Alex Chen",
    "Cancel",
  ]);
  expect(mockLeave).toHaveBeenCalledWith({ postId: "post-a" });
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith("Removed from this visit."));
});
