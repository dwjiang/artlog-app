import { render, screen } from "@testing-library/react-native";

import { TagScreen } from "./tag-screen";

let mockSummary: { data?: { tag: string; postCount: number } | null };
let mockPosts: { postId: string }[];
const mockScreen = jest.fn();
jest.mock("@/lib/social/use-social-session", () => ({
  useSocialSession: () => ({ status: "signed-out", key: "guest", offline: false }),
}));
jest.mock("@/lib/social/use-social-query", () => ({
  useSocialQuery: () => ({ ...mockSummary, refresh: jest.fn() }),
  useCursorPages: () => ({
    items: mockPosts,
    done: true,
    loading: false,
    refreshing: false,
    canLoadMore: false,
    loadMore: jest.fn(),
    refresh: jest.fn(),
  }),
}));
jest.mock("@/lib/social/use-block", () => ({ useBlock: () => ({ block: jest.fn() }) }));
jest.mock("expo-router", () => ({
  Stack: { Screen: (props: object) => mockScreen(props) ?? null },
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("./visit-card", () => ({
  VisitCard: ({ visit }: { visit: { postId: string } }) => {
    const { Text } = jest.requireActual("react-native");
    return <Text>{`Post ${visit.postId}`}</Text>;
  },
}));

beforeEach(() => {
  mockSummary = { data: { tag: "impressionism", postCount: 214 } };
  mockPosts = [{ postId: "a" }, { postId: "b" }];
});

it("titles the page with the tag and lists its posts under the public count", async () => {
  await render(<TagScreen tag="impressionism" />);
  expect(mockScreen).toHaveBeenCalledWith({ options: { title: "#impressionism" } });
  expect(screen.getByText("214 public posts")).toBeOnTheScreen();
  expect(screen.getByText("Post a")).toBeOnTheScreen();
  expect(screen.getByText("Post b")).toBeOnTheScreen();
});

it("says when nobody has used the tag yet", async () => {
  mockSummary = { data: { tag: "monet", postCount: 0 } };
  mockPosts = [];
  await render(<TagScreen tag="monet" />);
  expect(screen.getByText("No posts with #monet yet.")).toBeOnTheScreen();
  expect(screen.queryByText(/public post/)).toBeNull();
});

it("shows a tag that can't have a page as unavailable", async () => {
  mockSummary = { data: null };
  mockPosts = [];
  await render(<TagScreen tag="1" />);
  expect(screen.getByText("Tag unavailable.")).toBeOnTheScreen();
});
