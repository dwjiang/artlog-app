import { act, fireEvent, render, renderHook, screen } from "@testing-library/react-native";
import type { FunctionReference } from "convex/server";

import type { SocialSession } from "@/lib/social/use-social-session";
import { dismissToast, showErrorToast, useToast } from "@/lib/ui/toast";

import { VisitReactions, type ReactionVisit } from "./visit-reactions";

const mockPush = jest.fn();
const mockMutate = jest.fn();
const mockRefresh = jest.fn();
let mockSession: SocialSession;
let mockSummary: { likeCount: number; commentCount: number; liked: boolean };
let mockComments: object[];
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("convex/react", () => ({
  useMutation: (query: FunctionReference<"mutation">) => (args: unknown) =>
    mockMutate(jest.requireActual("convex/server").getFunctionName(query), args),
}));
jest.mock("@/lib/social/use-social-session", () => ({
  useSocialSession: () => mockSession,
}));
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
const mockBlock = jest.fn();
jest.mock("@/lib/social/use-block", () => ({ useBlock: () => ({ block: mockBlock }) }));

const visit: ReactionVisit = { postId: "visit-a", audience: "public" };

beforeEach(() => {
  jest.clearAllMocks();
  dismissToast();
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
  const toast = await renderHook(useToast);
  mockMutate.mockRejectedValueOnce(new Error("Network"));
  await render(<VisitReactions visit={visit} />);
  await fireEvent.press(screen.getByRole("button", { name: "Unlike visit" }));
  expect(screen.getByRole("button", { name: "Unlike visit", selected: true })).toBeOnTheScreen();
  expect(toast.result.current).toMatchObject({ message: "Couldn’t update your like.", action: { label: "Retry" } });
  await act(() => toast.result.current?.action?.onPress());
  expect(mockMutate).toHaveBeenCalledTimes(2);
});

it("lets guests read comments and asks them to sign in before reacting", async () => {
  mockSession = {
    ...mockSession,
    status: "signed-out",
    profileId: undefined,
    token: null,
  };
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
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/sign-in",
    params: { context: "reactions" },
  });
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
  expect(screen.getByText("Couldn’t post your comment. Your text is still here.")).toBeOnTheScreen();
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

it("reports someone else’s comment after closing the sheet, and offers Delete instead on your own", async () => {
  mockComments = [
    {
      commentId: "theirs",
      body: "Rude words.",
      createdAt: 1,
      isAuthor: false,
      author: { profileId: "friend", name: "Jules Morgan" },
    },
    {
      commentId: "mine",
      body: "My note.",
      createdAt: 2,
      isAuthor: false,
      author: { profileId: "me", name: "Me" },
    },
  ];
  await render(<VisitReactions visit={visit} />);
  await fireEvent.press(screen.getByRole("button", { name: "Open 2 comments" }));
  expect(screen.queryByRole("button", { name: "Report comment: My note." })).toBeNull();
  expect(screen.getByRole("button", { name: "Delete comment: My note." })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Report comment: Rude words." }));
  expect(screen.queryByText("Rude words.")).toBeNull();
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/report", params: { kind: "comment", id: "theirs" } });
});

it("offers Block beside Report on someone else’s comment, but not on your own or to guests", async () => {
  const theirs = { profileId: "friend", name: "Jules Morgan" };
  mockComments = [
    { commentId: "theirs", body: "Rude words.", createdAt: 1, isAuthor: false, author: theirs },
    { commentId: "mine", body: "My note.", createdAt: 2, isAuthor: false, author: { profileId: "me", name: "Me" } },
  ];
  const view = await render(<VisitReactions visit={visit} />);
  await fireEvent.press(screen.getByRole("button", { name: "Open 2 comments" }));
  expect(screen.queryByRole("button", { name: "Block Me" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Block Jules Morgan" }));
  expect(mockBlock).toHaveBeenCalledWith(theirs);
  mockSession = { ...mockSession, status: "signed-out", profileId: undefined };
  await view.rerender(<VisitReactions visit={visit} />);
  expect(screen.getByRole("button", { name: "Report comment: Rude words." })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Block Jules Morgan" })).toBeNull();
});

it("shows a failed block and its retry inside the open comments sheet", async () => {
  const retry = jest.fn();
  mockBlock.mockImplementationOnce(() => showErrorToast("Couldn’t block Jules Morgan.", retry));
  mockComments = [
    {
      commentId: "theirs",
      body: "A comment.",
      createdAt: 1,
      isAuthor: false,
      author: { profileId: "friend", name: "Jules Morgan" },
    },
  ];
  await render(<VisitReactions visit={visit} />);
  await fireEvent.press(screen.getByRole("button", { name: "Open 2 comments" }));
  await fireEvent.press(screen.getByRole("button", { name: "Block Jules Morgan" }));
  expect(screen.getByText("Couldn’t block Jules Morgan.")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Close comments" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Couldn’t block Jules Morgan.")).toBeNull();
});
