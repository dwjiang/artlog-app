import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { FunctionReference } from "convex/server";
import type { SocialSession } from "@/lib/social/use-social-session";
import { VisitReactions, type ReactionVisit } from "./visit-reactions";

const mockPush = jest.fn(),
  mockMutate = jest.fn(),
  mockRefresh = jest.fn();
let mockSession: SocialSession;
let mockSummary: { likeCount: number; commentCount: number; liked: boolean };
let mockComments: object[];
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("convex/react", () => ({
  useMutation: (query: FunctionReference<"mutation">) => (args: unknown) =>
    mockMutate(jest.requireActual("convex/server").getFunctionName(query), args),
}));
jest.mock("@/lib/social/use-social-session", () => ({ useSocialSession: () => mockSession }));
jest.mock("@/lib/social/use-social-query", () => ({
  useSocialQuery: () => ({ data: mockSummary, refresh: mockRefresh }),
  useCursorPages: () => ({
    items: mockComments,
    done: true,
    loading: false,
    canLoadMore: false,
    loadMore: jest.fn(),
    refresh: mockRefresh,
  }),
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => "request-uuid" }));

const visit: ReactionVisit = {
  postId: "visit-a",
  author: {
    profileId: "author" as never,
    name: "Maya Park",
    username: "maya",
    publishedWallCount: 0,
  },
  venue: { venueId: "museum" as never, name: "MoMA" },
  visitedOn: "2026-09-20",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSession = {
    key: "me",
    profileId: "me" as never,
    token: "token",
    status: "ready",
    accountReady: true,
    offline: false,
    error: undefined,
    refresh: mockRefresh,
  };
  mockSummary = { likeCount: 13, commentCount: 2, liked: true };
  mockComments = [];
  mockMutate.mockResolvedValue("new-comment");
});

it("shows the liked state and submits only one unlike while a request is pending", async () => {
  let resolve!: () => void;
  mockMutate.mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  await render(<VisitReactions visit={visit} />);
  expect(screen.getByText("Liked by you and 12 others")).toBeOnTheScreen();
  const unlike = screen.getByRole("button", { name: "Unlike visit" });
  expect(screen.getByRole("button", { name: "Unlike visit", selected: true })).toBeOnTheScreen();
  await fireEvent.press(unlike);
  await fireEvent.press(unlike);
  expect(mockMutate).toHaveBeenCalledTimes(1);
  expect(mockMutate).toHaveBeenCalledWith("visitReactions:setLike", {
    postId: "visit-a",
    liked: false,
  });
  expect(screen.getByRole("button", { name: "Unlike visit", busy: true })).toBeDisabled();
  await act(() => resolve());
});

it("keeps the like state and exposes retry after a failed write", async () => {
  mockMutate.mockRejectedValueOnce(new Error("Network"));
  await render(<VisitReactions visit={visit} />);
  await fireEvent.press(screen.getByRole("button", { name: "Unlike visit" }));
  expect(screen.getByRole("button", { name: "Unlike visit", selected: true })).toBeOnTheScreen();
  expect(screen.getByText("Couldn’t update your like. Try again.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Retry reactions" }));
  expect(mockMutate).toHaveBeenCalledTimes(2);
});

it("lets guests read comments and asks them to sign in before reacting", async () => {
  mockSession = { ...mockSession, status: "signed-out", profileId: undefined, token: null };
  mockComments = [
    {
      commentId: "comment",
      body: "Beautiful light.",
      createdAt: 1,
      isAuthor: false,
      author: { profileId: "friend", name: "Jules Morgan" },
    },
  ];
  await render(<VisitReactions visit={visit} />);
  await fireEvent.press(screen.getByRole("button", { name: "Open 2 comments" }));
  expect(screen.getByText("Beautiful light.")).toBeOnTheScreen();
  expect(screen.queryByLabelText("Add a comment")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/sign-in", params: { context: "reactions" } });
  expect(mockMutate).not.toHaveBeenCalled();
});

it("preserves a failed comment draft and reuses its request ID on retry", async () => {
  mockMutate.mockRejectedValueOnce(new Error("Network"));
  await render(<VisitReactions visit={visit} />);
  await fireEvent.press(screen.getByRole("button", { name: "Open 2 comments" }));
  expect(screen.getByRole("button", { name: "Post comment" })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText("Add a comment"), "A familiar favorite.");
  await fireEvent.press(screen.getByRole("button", { name: "Post comment" }));
  expect(screen.getByLabelText("Add a comment").props.value).toBe("A familiar favorite.");
  expect(
    screen.getByText("Couldn’t post your comment. Your text is still here."),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Post comment" }));
  expect(mockMutate.mock.calls[0]).toEqual(mockMutate.mock.calls[1]);
  expect(screen.getByLabelText("Add a comment").props.value).toBe("");
});

it("opens the likes list from the compact summary and dismisses it", async () => {
  mockComments = [{ profileId: "friend", name: "Jules Morgan", username: "jules" }];
  await render(<VisitReactions visit={visit} />);
  await fireEvent.press(screen.getByRole("button", { name: "See who liked this visit" }));
  expect(screen.getByText("@jules")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Close likes" }));
  expect(screen.queryByText("@jules")).toBeNull();
});
