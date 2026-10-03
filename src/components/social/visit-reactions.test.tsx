import { act, fireEvent, render, renderHook, screen } from "@testing-library/react-native";
import type { FunctionReference } from "convex/server";
import { ActionSheetIOS } from "react-native";

import type { SocialSession } from "@/lib/social/use-social-session";
import { dismissToast, showErrorToast, useToast } from "@/lib/ui/toast";

import { VisitReactions, type ReactionSummary, type ReactionVisit } from "./visit-reactions";

const mockPush = jest.fn();
const mockMutate = jest.fn();
const mockRefresh = jest.fn();
let mockSession: SocialSession;
let mockSummary: ReactionSummary;
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
jest.mock("expo-haptics", () => ({ impactAsync: async () => {}, ImpactFeedbackStyle: { Medium: "medium" } }));
const mockCopy = jest.fn();
jest.mock("expo-clipboard", () => ({ setStringAsync: (text: string) => mockCopy(text) }));
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
  mockSummary = { likeCount: 13, commentCount: 2, liked: true, latestComment: null };
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
      likeCount: 0,
      liked: false,
      author: { profileId: "friend", name: "Jules Morgan" },
    },
  ];
  await render(<VisitReactions visit={visit} />);
  await fireEvent.press(screen.getByRole("button", { name: "Open 2 comments" }));
  expect(screen.getByText("Beautiful light.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Like Jules Morgan’s comment" }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/sign-in",
    params: { context: "reactions" },
  });
  mockPush.mockClear();
  await fireEvent.press(screen.getByRole("button", { name: "Open 2 comments" }));
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

it("previews the newest comment under the visit and opens the sheet from it", async () => {
  mockSummary = {
    ...mockSummary,
    latestComment: { commentId: "newest" as never, authorName: "Jules Morgan", body: "Beautiful light." },
  };
  const view = await render(<VisitReactions visit={visit} />);
  expect(screen.getByText("View all 2 comments")).toBeOnTheScreen();
  await fireEvent.press(
    screen.getByRole("button", { name: "View all 2 comments. Latest from Jules Morgan: Beautiful light." }),
  );
  expect(screen.getByRole("header", { name: "Comments 2" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Close comments" }));
  mockSummary = { ...mockSummary, commentCount: 1 };
  await view.rerender(<VisitReactions visit={visit} />);
  expect(screen.queryByText(/View all/)).toBeNull();
  expect(screen.getByRole("button", { name: "Open comment from Jules Morgan: Beautiful light." })).toBeOnTheScreen();
});

it("shows a comment heart at once while its write is in flight", async () => {
  let resolve!: () => void;
  mockMutate.mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  mockComments = [comment("theirs", "Beautiful light.", { profileId: "friend", name: "Jules Morgan" }, 2)];
  await render(<VisitReactions visit={visit} openComments />);
  await fireEvent.press(screen.getByRole("button", { name: "Like Jules Morgan’s comment" }));
  expect(mockMutate).toHaveBeenCalledWith("visitReactions:setCommentLike", {
    postId: "visit-a",
    commentId: "theirs",
    liked: true,
  });
  const pending = screen.getByRole("button", {
    name: "Unlike Jules Morgan’s comment",
    selected: true,
    busy: true,
    value: { text: "3 likes" },
  });
  expect(pending).toBeDisabled();
  await act(() => resolve());
  // The mocked list never receives the saved like, so the heart falls back to the server's state.
  expect(
    screen.getByRole("button", { name: "Like Jules Morgan’s comment", selected: false, value: { text: "2 likes" } }),
  ).toBeOnTheScreen();
});

const theirs = { profileId: "friend", name: "Jules Morgan" };
function comment(commentId: string, body: string, author: { profileId: string; name: string }, likeCount = 0) {
  return { commentId, body, createdAt: 1, isAuthor: false, likeCount, liked: false, author };
}
function chooseAction(label: string) {
  return jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementation((options, choose) => {
    choose(options.options.indexOf(label));
  });
}

it("reports someone else’s comment from its touch-and-hold menu after closing the sheet", async () => {
  mockComments = [comment("theirs", "Rude words.", theirs)];
  const sheet = chooseAction("Report comment");
  await render(<VisitReactions visit={visit} openComments />);
  await fireEvent(screen.getByLabelText(/Rude words\.$/), "longPress");
  expect(sheet.mock.calls[0][0]).toMatchObject({
    options: ["Copy comment", "Report comment", "Block Jules Morgan", "Cancel"],
    destructiveButtonIndex: [2],
  });
  expect(screen.queryByText("Rude words.")).toBeNull();
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/report", params: { kind: "comment", id: "theirs" } });
  sheet.mockRestore();
});

it("offers Delete instead of Report and Block on your own comment", async () => {
  mockComments = [comment("mine", "My note.", { profileId: "me", name: "Me" })];
  const sheet = chooseAction("Cancel");
  await render(<VisitReactions visit={visit} openComments />);
  await fireEvent(screen.getByLabelText(/My note\.$/), "longPress");
  expect(sheet.mock.calls[0][0]).toMatchObject({
    options: ["Copy comment", "Delete comment", "Cancel"],
    destructiveButtonIndex: [1],
  });
  sheet.mockRestore();
});

it("copies a comment and gives guests Report without Block", async () => {
  mockSession = { ...mockSession, status: "signed-out", profileId: undefined };
  mockCopy.mockResolvedValue(true);
  mockComments = [comment("theirs", "Beautiful light.", theirs)];
  const sheet = chooseAction("Copy comment");
  await render(<VisitReactions visit={visit} openComments />);
  await fireEvent(screen.getByLabelText(/Beautiful light\.$/), "longPress");
  expect(sheet.mock.calls[0][0].options).toEqual(["Copy comment", "Report comment", "Cancel"]);
  expect(mockCopy).toHaveBeenCalledWith("Beautiful light.");
  expect(await screen.findByText("Comment copied.")).toBeOnTheScreen();
  sheet.mockRestore();
});

it("gives VoiceOver the same comment actions and shows a failed block inside the sheet", async () => {
  const retry = jest.fn();
  mockBlock.mockImplementationOnce(() => showErrorToast("Couldn’t block Jules Morgan.", retry));
  mockComments = [comment("theirs", "A comment.", theirs)];
  await render(<VisitReactions visit={visit} openComments />);
  const row = screen.getByLabelText(/A comment\.$/);
  expect(row.props.accessibilityActions).toEqual([
    { name: "copy", label: "Copy comment" },
    { name: "report", label: "Report comment" },
    { name: "block", label: "Block Jules Morgan" },
  ]);
  await fireEvent(row, "accessibilityAction", { nativeEvent: { actionName: "block" } });
  expect(mockBlock).toHaveBeenCalledWith(theirs);
  expect(screen.getByText("Couldn’t block Jules Morgan.")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Close comments" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Couldn’t block Jules Morgan.")).toBeNull();
});
