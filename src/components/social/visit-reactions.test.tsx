import { act, fireEvent, render, renderHook, screen } from "@testing-library/react-native";
import type { FunctionReference } from "convex/server";
import { ActionSheetIOS } from "react-native";

import type { SocialSession } from "@/lib/social/use-social-session";
import { dismissToast, showErrorToast, useToast } from "@/lib/ui/toast";
import { MAX_COMMENT_LENGTH } from "@/shared/social/visit-reactions";

import { VisitReactions, type ReactionSummary, type ReactionVisit } from "./visit-reactions";

const mockPush = jest.fn();
const mockMutate = jest.fn();
const mockRefresh = jest.fn();
let mockSession: SocialSession;
let mockSummary: ReactionSummary;
let mockComments: object[];
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("convex/react", () => {
  const call = (query: FunctionReference<"mutation" | "action">) => (args: unknown) =>
    mockMutate(jest.requireActual("convex/server").getFunctionName(query), args);
  return { useMutation: call, useAction: call };
});
jest.mock("@/lib/social/use-social-session", () => ({
  useSocialSession: () => mockSession,
}));
let mockTags: { tag: string; postCount: number }[];
const mockTagSearch = jest.fn();
let mockPeople: object[];
const mockPeopleSearch = jest.fn();
jest.mock("@/lib/social/use-social-query", () => ({
  useSocialQuery: (query: never, args: unknown) => {
    const name = jest.requireActual("convex/server").getFunctionName(query);
    if (name === "mentions:suggest") {
      if (args !== "skip") mockPeopleSearch(args);
      return { data: args === "skip" ? undefined : mockPeople, refresh: mockRefresh };
    }
    if (name !== "tags:search") {
      return { data: mockSummary, refresh: mockRefresh };
    }
    if (args !== "skip") mockTagSearch(args);
    return { data: args === "skip" ? undefined : mockTags, refresh: mockRefresh };
  },
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
const mockImpact = jest.fn(async (_style: string) => {});
jest.mock("expo-haptics", () => ({
  impactAsync: (style: string) => mockImpact(style),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
}));
const mockCopy = jest.fn();
jest.mock("expo-clipboard", () => ({ setStringAsync: (text: string) => mockCopy(text) }));
const mockBlock = jest.fn();
jest.mock("@/lib/social/use-block", () => ({ useBlock: () => ({ block: mockBlock }) }));

const visit: ReactionVisit = { postId: "visit-a" };

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
  mockTags = [];
  mockPeople = [];
  mockMutate.mockResolvedValue("new-comment");
});

it("shows an unlike at once, silently, and submits only one while it is pending", async () => {
  let resolve!: () => void;
  mockMutate.mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  await render(<VisitReactions visit={visit} />);
  expect(screen.getByText("Liked by you and 12 others")).toBeOnTheScreen();
  const unlike = screen.getByRole("button", { name: "Unlike visit", selected: true });
  await fireEvent.press(unlike);
  await fireEvent.press(unlike);
  expect(mockMutate).toHaveBeenCalledTimes(1);
  expect(mockMutate).toHaveBeenCalledWith("visitReactions:setLike", {
    postId: "visit-a",
    liked: false,
  });
  expect(
    screen.getByRole("button", { name: "Like visit", selected: false, busy: true, value: { text: "12 likes" } }),
  ).toBeDisabled();
  expect(screen.getByText("12 people like this")).toBeOnTheScreen();
  expect(mockImpact).not.toHaveBeenCalled();
  await act(() => resolve());
});

it("fills the heart with one light haptic as soon as a visit is liked", async () => {
  mockSummary = { ...mockSummary, likeCount: 12, liked: false };
  let resolve!: () => void;
  mockMutate.mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  await render(<VisitReactions visit={visit} />);
  await fireEvent.press(screen.getByRole("button", { name: "Like visit", selected: false }));
  expect(
    screen.getByRole("button", { name: "Unlike visit", selected: true, value: { text: "13 likes" } }),
  ).toBeDisabled();
  expect(screen.getByText("Liked by you and 12 others")).toBeOnTheScreen();
  expect(mockImpact).toHaveBeenCalledTimes(1);
  expect(mockImpact).toHaveBeenCalledWith("light");
  await act(() => resolve());
  // The mocked summary never receives the saved like, so the heart falls back to the server's state.
  expect(screen.getByRole("button", { name: "Like visit", selected: false })).toBeEnabled();
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
      mentions: [],
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
  expect(screen.getByLabelText("Add a comment")).toHaveTextContent("A familiar favorite.");
  expect(screen.getByText("Couldn’t post your comment. Your text is still here.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Post comment" }));
  expect(mockMutate.mock.calls[0]).toEqual(mockMutate.mock.calls[1]);
  expect(screen.getByLabelText("Add a comment")).toHaveTextContent("");
});

it("opens the likes list from the compact summary and dismisses it", async () => {
  mockComments = [{ profileId: "friend", name: "Jules Morgan", username: "jules" }];
  await render(<VisitReactions visit={visit} />);
  await fireEvent.press(screen.getByRole("button", { name: "See who liked this visit" }));
  expect(screen.getByText("@jules")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Close likes" }));
  expect(screen.queryByText("@jules")).toBeNull();
});

it("closes the likes sheet before opening a liker’s profile", async () => {
  mockComments = [{ profileId: "friend", name: "Jules Morgan", username: "jules" }];
  await render(<VisitReactions visit={visit} />);
  await fireEvent.press(screen.getByRole("button", { name: "See who liked this visit" }));
  await fireEvent.press(screen.getByRole("button", { name: "View Jules Morgan’s profile" }));
  expect(screen.queryByText("@jules")).toBeNull();
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/profile/[profileId]", params: { profileId: "friend" } });
});

it("previews the newest comment under the visit and opens the sheet from it", async () => {
  mockSummary = {
    ...mockSummary,
    latestComment: {
      commentId: "newest" as never,
      author: { profileId: "friend" as never, name: "Jules Morgan" },
      body: "Beautiful light.",
      mentions: [],
    },
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

it("opens the previewed comment author’s profile, by touch or with VoiceOver", async () => {
  mockSummary = {
    ...mockSummary,
    latestComment: {
      commentId: "newest" as never,
      author: { profileId: "friend" as never, name: "Jules Morgan" },
      body: "Beautiful light.",
      mentions: [],
    },
  };
  await render(<VisitReactions visit={visit} />);
  await fireEvent.press(screen.getByRole("link", { name: "Jules Morgan" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/profile/[profileId]", params: { profileId: "friend" } });
  expect(screen.queryByRole("header", { name: "Comments 2" })).toBeNull();

  mockPush.mockClear();
  const preview = screen.getByRole("button", { name: /Latest from Jules Morgan/ });
  expect(preview.props.accessibilityActions).toEqual([{ name: "profile", label: "View Jules Morgan’s profile" }]);
  await fireEvent(preview, "accessibilityAction", { nativeEvent: { actionName: "profile" } });
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/profile/[profileId]", params: { profileId: "friend" } });
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
  expect(mockImpact).toHaveBeenCalledTimes(1);
  expect(mockImpact).toHaveBeenCalledWith("light");
  await act(() => resolve());
  // The mocked list never receives the saved like, so the heart falls back to the server's state.
  expect(
    screen.getByRole("button", { name: "Like Jules Morgan’s comment", selected: false, value: { text: "2 likes" } }),
  ).toBeOnTheScreen();
});

const theirs = { profileId: "friend", name: "Jules Morgan", username: "jules" };
function comment(
  commentId: string,
  body: string,
  author: { profileId: string; name: string; username?: string },
  likeCount = 0,
  mentions: { username: string; profileId: string }[] = [],
) {
  return { commentId, body, createdAt: 1, isAuthor: false, likeCount, liked: false, author, mentions };
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
    options: ["Reply", "Copy comment", "Report comment", "Block Jules Morgan", "Cancel"],
    destructiveButtonIndex: [3],
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
    { name: "reply", label: "Reply" },
    { name: "copy", label: "Copy comment" },
    { name: "report", label: "Report comment" },
    { name: "block", label: "Block Jules Morgan" },
    { name: "profile", label: "View Jules Morgan’s profile" },
  ]);
  await fireEvent(row, "accessibilityAction", { nativeEvent: { actionName: "block" } });
  expect(mockBlock).toHaveBeenCalledWith(theirs);
  expect(screen.getByText("Couldn’t block Jules Morgan.")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Close comments" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Couldn’t block Jules Morgan.")).toBeNull();
});

it("opens a tag from the comment preview", async () => {
  mockSummary = {
    ...mockSummary,
    latestComment: {
      commentId: "newest" as never,
      author: { profileId: "friend" as never, name: "Jules Morgan" },
      body: "Saving this for #SketchSunday",
      mentions: [],
    },
  };
  await render(<VisitReactions visit={visit} />);
  await fireEvent.press(screen.getByRole("link", { name: "#SketchSunday" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/tag/[tag]", params: { tag: "sketchsunday" } });
  expect(screen.queryByRole("header", { name: "Comments 2" })).toBeNull();
});

it("closes the comments before opening a tag, by touch or with VoiceOver", async () => {
  mockComments = [comment("theirs", "Water lilies, then the #ukiyoe room?", theirs)];
  const view = await render(<VisitReactions visit={visit} openComments />);
  await fireEvent.press(screen.getByRole("link", { name: "#ukiyoe" }));
  expect(screen.queryByRole("header", { name: "Comments 2" })).toBeNull();
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/tag/[tag]", params: { tag: "ukiyoe" } });

  mockPush.mockClear();
  await view.unmount();
  await render(<VisitReactions visit={visit} openComments />);
  const row = screen.getByLabelText(/the #ukiyoe room\?$/);
  expect(row.props.accessibilityActions).toContainEqual({ name: "tag:ukiyoe", label: "Open #ukiyoe" });
  await fireEvent(row, "accessibilityAction", { nativeEvent: { actionName: "tag:ukiyoe" } });
  expect(screen.queryByRole("header", { name: "Comments 2" })).toBeNull();
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/tag/[tag]", params: { tag: "ukiyoe" } });
});

it("suggests tags in use while a comment's tag is typed and completes the chosen one", async () => {
  jest.useFakeTimers();
  mockTags = [
    { tag: "ukiyoe", postCount: 37 },
    { tag: "ukiyo", postCount: 1 },
  ];
  await render(<VisitReactions visit={visit} openComments />);
  const input = screen.getByLabelText("Add a comment");
  await fireEvent.changeText(input, "Then the room");
  await fireEvent(input, "selectionChange", { nativeEvent: { selection: { start: 13, end: 13 } } });
  await act(() => jest.advanceTimersByTime(200));
  expect(mockTagSearch).not.toHaveBeenCalled();

  await fireEvent.changeText(input, "Then the #Uki room");
  await fireEvent(input, "selectionChange", { nativeEvent: { selection: { start: 13, end: 13 } } });
  await act(() => jest.advanceTimersByTime(200));
  expect(mockTagSearch).toHaveBeenLastCalledWith({ prefix: "uki" });
  expect(screen.getByRole("button", { name: "#ukiyo, 1 post" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "#ukiyoe, 37 posts" }));
  expect(screen.getByLabelText("Add a comment")).toHaveTextContent("Then the #ukiyoe room");
  expect(screen.getByLabelText("Add a comment").props.selection).toEqual({ start: 17, end: 17 });
  expect(screen.queryByRole("button", { name: "#ukiyoe, 37 posts" })).toBeNull();
  jest.useRealTimers();
});

it("omits completions that would exceed the comment limit while allowing one that fits", async () => {
  jest.useFakeTimers();
  mockTags = [
    { tag: "impressionism", postCount: 5 },
    { tag: "imp", postCount: 1 },
  ];
  await render(<VisitReactions visit={visit} openComments />);
  const input = screen.getByLabelText("Add a comment");
  const draft = "x".repeat(994) + " #imp";
  await fireEvent.changeText(input, draft);
  await fireEvent(input, "selectionChange", { nativeEvent: { selection: { start: draft.length, end: draft.length } } });
  await act(() => jest.advanceTimersByTime(200));
  expect(screen.queryByRole("button", { name: "#impressionism, 5 posts" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "#imp, 1 post" }));
  await fireEvent.press(screen.getByRole("button", { name: "Post comment" }));
  expect(mockMutate).toHaveBeenCalledWith("visitReactions:addComment", {
    postId: visit.postId,
    body: draft,
    requestId: "request-uuid",
  });
  jest.useRealTimers();
});

it("locks hashtag completion while posting and restores it after a failure", async () => {
  jest.useFakeTimers();
  try {
    mockTags = [{ tag: "monet", postCount: 1 }];
    let reject!: (cause: Error) => void;
    mockMutate.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    await render(<VisitReactions visit={visit} openComments />);
    const input = screen.getByLabelText("Add a comment");
    await fireEvent.changeText(input, "#mon");
    await fireEvent(input, "selectionChange", { nativeEvent: { selection: { start: 4, end: 4 } } });
    await act(() => jest.advanceTimersByTime(200));
    expect(screen.getByRole("button", { name: "#monet, 1 post" })).toBeEnabled();
    await fireEvent.press(screen.getByRole("button", { name: "Post comment" }));
    expect(screen.getByLabelText("Add a comment")).toHaveProp("editable", false);
    const suggestion = screen.getByRole("button", { name: "#monet, 1 post" });
    expect(suggestion).toBeDisabled();
    await fireEvent.press(suggestion);
    expect(input).toHaveTextContent("#mon", { exact: true });
    expect(mockMutate).toHaveBeenCalledWith("visitReactions:addComment", {
      postId: visit.postId,
      body: "#mon",
      requestId: "request-uuid",
    });
    await act(() => reject(new Error("Network")));
    expect(screen.getByRole("button", { name: "#monet, 1 post" })).toBeEnabled();
    await fireEvent.press(screen.getByRole("button", { name: "#monet, 1 post" }));
    expect(input).toHaveTextContent("#monet", { exact: true });
    await fireEvent.press(screen.getByRole("button", { name: "Post comment" }));
    expect(mockMutate).toHaveBeenLastCalledWith("visitReactions:addComment", {
      postId: visit.postId,
      body: "#monet",
      requestId: "request-uuid",
    });
    expect(input).toHaveTextContent("");
  } finally {
    jest.useRealTimers();
  }
});

it("links handles the comment resolved and closes the sheet before opening the profile", async () => {
  mockComments = [
    comment("theirs", "@maya the Caillebotte is two rooms over, @nobody.", theirs, 0, [
      { username: "maya", profileId: "maya-id" },
    ]),
  ];
  await render(<VisitReactions visit={visit} openComments />);
  expect(screen.getAllByRole("link").map((link) => link.props.children)).toEqual(["Jules Morgan", "@maya"]);
  await fireEvent.press(screen.getByRole("link", { name: "@maya" }));
  expect(screen.queryByRole("header", { name: "Comments 2" })).toBeNull();
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/profile/[profileId]", params: { profileId: "maya-id" } });
});

it.each([
  ["name", () => fireEvent.press(screen.getByRole("link", { name: "Jules Morgan" }))],
  ["photo", () => fireEvent.press(screen.getByText("JM", { includeHiddenElements: true }))],
  [
    "VoiceOver action",
    () =>
      fireEvent(screen.getByLabelText(/Found it\.$/), "accessibilityAction", {
        nativeEvent: { actionName: "profile" },
      }),
  ],
])("closes the comments before opening a commenter’s profile from their %s", async (_, open) => {
  mockComments = [comment("theirs", "Found it.", theirs)];
  await render(<VisitReactions visit={visit} openComments />);
  await open();
  expect(screen.queryByRole("header", { name: "Comments 2" })).toBeNull();
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/profile/[profileId]", params: { profileId: "friend" } });
});

it("suggests people for a typed handle and completes the chosen one", async () => {
  jest.useFakeTimers();
  mockPeople = [
    { profile: { profileId: "maya-id", name: "Maya Chen", username: "maya", avatar: "vermeer" }, role: "author" },
    { profile: { profileId: "marisol-id", name: "Marisol Vega", username: "marisol", avatar: "vermeer" } },
  ];
  await render(<VisitReactions visit={visit} openComments />);
  const input = screen.getByLabelText("Add a comment");
  await fireEvent.changeText(input, "Loved this. @Ma");
  await fireEvent(input, "selectionChange", { nativeEvent: { selection: { start: 15, end: 15 } } });
  await act(() => jest.advanceTimersByTime(200));
  expect(mockPeopleSearch).toHaveBeenLastCalledWith({ query: "ma", place: { kind: "comment", postId: "visit-a" } });
  expect(screen.getByRole("button", { name: "Marisol Vega, @marisol" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Maya Chen, @maya, Author" }));
  expect(screen.getByLabelText("Add a comment")).toHaveTextContent("Loved this. @maya");
  expect(screen.getByLabelText("Add a comment").props.selection).toEqual({ start: 18, end: 18 });
  jest.useRealTimers();
});

it("starts a reply with the person's handle, by the Reply link or the touch-and-hold menu", async () => {
  mockComments = [comment("theirs", "Found it.", theirs), comment("mine", "Mine.", { profileId: "me", name: "Me" })];
  await render(<VisitReactions visit={visit} openComments />);
  expect(screen.getAllByText("Reply")).toHaveLength(1);
  await fireEvent.press(screen.getByText("Reply"));
  expect(screen.getByLabelText("Add a comment")).toHaveTextContent("@jules");
  expect(screen.getByText(/Replying to/)).toHaveTextContent("Replying to Jules Morgan");

  await fireEvent.press(screen.getByRole("button", { name: "Cancel reply" }));
  expect(screen.queryByText(/Replying to/)).toBeNull();
  expect(screen.getByLabelText("Add a comment")).not.toHaveTextContent("@jules");

  await fireEvent.changeText(screen.getByLabelText("Add a comment"), "See you there");
  const sheet = chooseAction("Reply");
  await fireEvent(screen.getByLabelText(/Found it\.$/), "longPress");
  expect(screen.getByLabelText("Add a comment")).toHaveTextContent("@jules See you there");
  sheet.mockRestore();
});

it("preserves a full draft and explains why a reply cannot be added", async () => {
  mockComments = [comment("theirs", "Found it.", theirs)];
  const draft = "x".repeat(MAX_COMMENT_LENGTH);
  await render(<VisitReactions visit={visit} openComments />);
  await fireEvent.changeText(screen.getByLabelText("Add a comment"), draft);
  await fireEvent.press(screen.getByText("Reply"));
  expect(screen.getByRole("alert")).toHaveTextContent("Shorten your comment to add a reply.");
  expect(screen.queryByText(/Replying to/)).toBeNull();
  expect(screen.getByLabelText("Add a comment")).toHaveTextContent(draft);
  await fireEvent.press(screen.getByRole("button", { name: "Post comment" }));
  expect(mockMutate).toHaveBeenCalledWith("visitReactions:addComment", {
    postId: visit.postId,
    body: draft,
    requestId: "request-uuid",
  });
});

it("allows a reply that exactly fits the comment limit after shortening the draft", async () => {
  mockComments = [comment("theirs", "Found it.", theirs)];
  await render(<VisitReactions visit={visit} openComments />);
  await fireEvent.changeText(screen.getByLabelText("Add a comment"), "x".repeat(MAX_COMMENT_LENGTH));
  await fireEvent.press(screen.getByText("Reply"));
  const prefix = `@${theirs.username} `;
  const draft = "x".repeat(MAX_COMMENT_LENGTH - prefix.length);
  await fireEvent.changeText(screen.getByLabelText("Add a comment"), draft);
  await fireEvent.press(screen.getByText("Reply"));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText(/Replying to/)).toHaveTextContent(`Replying to ${theirs.name}`);
  await fireEvent.press(screen.getByRole("button", { name: "Post comment" }));
  expect(mockMutate).toHaveBeenCalledWith("visitReactions:addComment", {
    postId: visit.postId,
    body: prefix + draft,
    requestId: "request-uuid",
  });
});
