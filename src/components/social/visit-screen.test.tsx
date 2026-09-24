import { fireEvent, render, screen } from "@testing-library/react-native";
import type { SharedArtwork, SharedVisit } from "@/lib/social/types";
import { VisitScreen } from "./visit-screen";

const mockPush = jest.fn(),
  mockLoadMore = jest.fn(),
  mockRefresh = jest.fn(),
  mockPages = jest.fn();
jest.mock("convex/react", () => ({
  ...jest.requireActual("convex/react"),
  useMutation: () => jest.fn(),
}));
jest.mock("@/lib/social/use-social-session", () => ({
  useSocialSession: () => ({
    status: "ready",
    key: "viewer",
    token: "visit-token",
  }),
}));
jest.mock("@/lib/social/use-social-query", () => ({
  useCursorPages: (...args: unknown[]) => mockPages(...args),
  useSocialQuery: () => ({ data: undefined }),
}));
jest.mock("@/components/settings/account-section", () => ({
  AccountSection: () => null,
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("expo-image", () => ({
  Image: (props: object) => {
    const { View } = jest.requireActual("react-native");
    return <View accessibilityRole="image" {...props} />;
  },
}));

const artwork = (
  id: string,
  title: string,
  artist = "Claude Monet",
): SharedArtwork => ({
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
    publishedWallCount: 0,
  },
  venue: { venueId: "museum" as never, name: "Musée d’Orsay", city: "Paris" },
  visitedOn: "2026-09-12",
  reflection: "The small details always win.",
  publishedAt: 1,
  revision: 1,
  artworkCount: 5,
  artworks: { page: works, cursor: null, isDone: true },
};
const pages = (patch: object = {}) => ({
  items: works,
  first: visit,
  loading: false,
  refreshing: false,
  done: true,
  canLoadMore: false,
  loadMore: mockLoadMore,
  refresh: mockRefresh,
  ...patch,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPages.mockReturnValue(pages());
});

it("shows the shared status, owner, place, reflection, and full artwork count", async () => {
  await render(<VisitScreen postId="post-a" />);
  expect(screen.getByText("Public")).toBeOnTheScreen();
  expect(screen.getByText("Musée d’Orsay")).toBeOnTheScreen();
  expect(screen.getByText(/September 12, 2026.*Paris/s)).toBeOnTheScreen();
  expect(screen.getByText("The small details always win.")).toBeOnTheScreen();
  expect(screen.getByText("5 artworks shared")).toBeOnTheScreen();
  await fireEvent.press(
    screen.getByRole("button", { name: "View Alex Chen’s profile" }),
  );
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/profile/[profileId]",
    params: { profileId: "alex" },
  });
});

it("offers search at five artworks and matches titles or artists without case or accent sensitivity", async () => {
  const view = await render(<VisitScreen postId="post-a" />);
  const search = screen.getByLabelText("Search visit artworks");
  await fireEvent.changeText(search, "  LILIES  ");
  expect(
    screen.getByRole("button", { name: "View Water Lilies" }),
  ).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "View The Dance" })).toBeNull();
  await fireEvent.changeText(search, "cezanne");
  expect(
    screen.getByRole("button", { name: "View Still Life" }),
  ).toBeOnTheScreen();
  expect(
    screen.queryByRole("button", { name: "View Water Lilies" }),
  ).toBeNull();
  await fireEvent.changeText(search, "no match");
  expect(screen.getByText("No artworks found.")).toBeOnTheScreen();
  mockPages.mockReturnValue(
    pages({ first: { ...visit, artworkCount: 4 }, items: works.slice(0, 4) }),
  );
  await view.rerender(<VisitScreen postId="post-b" />);
  expect(screen.queryByLabelText("Search visit artworks")).toBeNull();
});

it("searches later pages and waits until all pages arrive before declaring no matches", async () => {
  mockPages.mockReturnValue(
    pages({
      first: { ...visit, artworkCount: 6 },
      done: false,
      canLoadMore: true,
    }),
  );
  const view = await render(<VisitScreen postId="post-a" />);
  mockLoadMore.mockClear();
  await fireEvent.changeText(
    screen.getByLabelText("Search visit artworks"),
    "Starry",
  );
  expect(mockLoadMore).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("No artworks found.")).toBeNull();
  mockPages.mockReturnValue(
    pages({ first: { ...visit, artworkCount: 6 }, done: false, loading: true }),
  );
  await view.rerender(<VisitScreen postId="post-a" />);
  expect(screen.getByLabelText("Loading artworks…")).toBeOnTheScreen();
  expect(screen.queryByText("No artworks found.")).toBeNull();
  mockPages.mockReturnValue(
    pages({
      first: { ...visit, artworkCount: 6 },
      items: [...works, artwork("f", "Starry Night", "Vincent van Gogh")],
    }),
  );
  await view.rerender(<VisitScreen postId="post-a" />);
  await fireEvent.press(
    screen.getByRole("button", { name: "View Starry Night" }),
  );
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/artwork",
    params: { kind: "visit", postId: "post-a", itemId: "f" },
  });
  expect(screen.queryByText("No artworks found.")).toBeNull();
});

it("distinguishes a visit without photos from a visit without artworks", async () => {
  const media = works[0].artwork.media;
  mockPages.mockReturnValue(
    pages({
      items: [{ ...works[0], photos: [media, media] }, works[1]],
      first: { ...visit, artworkCount: 2 },
    }),
  );
  const view = await render(<VisitScreen postId="post-a" />);
  expect(screen.getByText("2 photos")).toBeOnTheScreen();
  expect(screen.getByText("No photos")).toBeOnTheScreen();
  mockPages.mockReturnValue(
    pages({ items: [], first: { ...visit, artworkCount: 0 } }),
  );
  await view.rerender(<VisitScreen postId="post-a" />);
  expect(screen.queryByText("A visit worth remembering.")).toBeNull();
  expect(
    screen.getByText("This visit was shared without artworks."),
  ).toBeOnTheScreen();
});
