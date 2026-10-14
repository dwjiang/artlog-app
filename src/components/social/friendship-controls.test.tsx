import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo, Alert } from "react-native";

import type { SocialSession } from "@/lib/social/use-social-session";

import { CompactFriendshipControls, FriendshipControls } from "./friendship-controls";

const mockPush = jest.fn();
const mockAct = jest.fn();
const mockUseFriendship = jest.fn();
const mockUnblock = jest.fn();
jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));
let mockState: object | undefined;
let mockPending: string | undefined;
jest.mock("@/lib/social/use-friendship", () => ({
  useFriendship: (...args: unknown[]) => {
    mockUseFriendship(...args);
    return { act: mockAct, state: mockState, pending: mockPending, confirmations: 0 };
  },
}));
const guest: SocialSession = {
  scope: undefined,
  status: "signed-out",
  key: "guest",
  token: null,
  profileId: undefined,
  accountReady: false,
  safetyChecks: false,
  offline: false,
  error: undefined,
  refresh: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAct.mockResolvedValue(true);
  mockState = undefined;
  mockPending = undefined;
});

it("lets guests request sign-in from the friend action without sending a request", async () => {
  await render(<FriendshipControls onUnblock={mockUnblock} profileId={"friend" as never} session={guest} />);
  expect(mockPush).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Add Friend" }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/sign-in",
    params: { context: "friends" },
  });
  expect(mockAct).not.toHaveBeenCalled();
});

it("continues to profile setup after sign-in without sending a request automatically", async () => {
  await render(
    <FriendshipControls
      onUnblock={mockUnblock}
      profileId={"friend" as never}

      session={{ ...guest, status: "profile-required" }}
    />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "Add Friend" }));
  expect(mockPush).toHaveBeenCalledWith("/create-profile");
  expect(mockAct).not.toHaveBeenCalled();
});

it("keeps friendship actions unavailable while offline", async () => {
  await render(
    <FriendshipControls
      onUnblock={mockUnblock}
      profileId={"friend" as never}

      session={{ ...guest, status: "offline", offline: true }}
    />,
  );
  expect(screen.queryByRole("button", { name: "Add Friend" })).toBeNull();
});

it("requires confirmation before removing an existing friend", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  mockState = { state: "accepted", blocked: false };
  await render(
    <FriendshipControls
      onUnblock={mockUnblock}
      profileId={"friend" as never}

      session={{ ...guest, status: "ready", profileId: "me" as never }}
    />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "Remove Friend…" }));
  expect(mockAct).not.toHaveBeenCalled();
  const confirm = alert.mock.calls.at(-1)?.[2]?.find((button) => button.style === "destructive");
  expect(confirm?.text).toBe("Remove friend");
  await act(() => confirm?.onPress?.());
  expect(mockAct).toHaveBeenCalledWith("remove");
  alert.mockRestore();
});

it("unsends a sent friend request from the sent button", async () => {
  mockState = { state: "pending", requesterId: "me", blocked: false, revision: 1 };
  await render(
    <FriendshipControls
      onUnblock={mockUnblock}
      profileId={"friend" as never}

      session={{ ...guest, status: "ready", profileId: "me" as never }}
    />,
  );
  expect(screen.getAllByRole("button")).toHaveLength(1);
  await fireEvent.press(screen.getByRole("button", { name: "Friend Request Sent" }));
  expect(mockAct).toHaveBeenCalledWith("cancel");
});

it("labels the answers to a received request as accepting or ignoring a friend", async () => {
  mockState = { state: "pending", requesterId: "friend", blocked: false, revision: 1 };
  await render(
    <FriendshipControls
      onUnblock={mockUnblock}
      profileId={"friend" as never}

      session={{ ...guest, status: "ready", profileId: "me" as never }}
    />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "Ignore" }));
  expect(mockAct).toHaveBeenCalledWith("decline");
  await fireEvent.press(screen.getByRole("button", { name: "Accept Friend" }));
  expect(mockAct).toHaveBeenCalledWith("accept");
});

it("shows progress inside the answer being sent", async () => {
  const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  mockState = { state: "pending", requesterId: "friend", blocked: false, revision: 1 };
  mockPending = "accept";
  await render(
    <FriendshipControls
      onUnblock={mockUnblock}
      profileId={"friend" as never}
      session={{ ...guest, status: "ready", profileId: "me" as never }}
    />,
  );
  expect(screen.getByRole("button", { name: "Accept Friend" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Ignore" })).toBeDisabled();
  expect(announce).toHaveBeenCalledWith("Accept Friend. In progress.");
  expect(announce).not.toHaveBeenCalledWith("Ignore. In progress.");
  expect(screen.queryByRole("progressbar")).toBeNull();
  announce.mockRestore();
});

it("holds a loading action until the friendship loads, and offers Unblock while blocked", async () => {
  const ready = { ...guest, status: "ready" as const, profileId: "me" as never };
  const view = await render(
    <FriendshipControls
      onUnblock={mockUnblock}
      profileId={"friend" as never}
      session={{ ...guest, status: "loading" }}
    />,
  );
  expect(screen.getByLabelText("Loading friendship…")).toBeOnTheScreen();
  await view.rerender(<FriendshipControls onUnblock={mockUnblock} profileId={"friend" as never} session={ready} />);
  expect(screen.getByLabelText("Loading friendship…")).toBeOnTheScreen();
  mockState = { state: "none", blocked: true };
  await view.rerender(<FriendshipControls onUnblock={mockUnblock} profileId={"friend" as never} session={ready} />);
  expect(screen.getAllByRole("button").map((button) => button.props.accessibilityLabel)).toEqual(["Unblock"]);
  await fireEvent.press(screen.getByRole("button", { name: "Unblock" }));
  expect(mockUnblock).toHaveBeenCalledTimes(1);
});

it("labels your own and a known friend’s rows without a relationship query and lets a stranger be added", async () => {
  mockState = { state: "none", blocked: false, revision: 0 };
  const ready = {
    ...guest,
    status: "ready" as const,
    profileId: "me" as never,
  };
  await render(
    <>
      <CompactFriendshipControls profileId={"me" as never} session={ready} />
      <CompactFriendshipControls profileId={"friend" as never} session={ready} friend />
      <CompactFriendshipControls profileId={"stranger" as never} session={ready} />
    </>,
  );
  expect(screen.getByText("You")).toBeOnTheScreen();
  expect(screen.getByText("Friends")).toBeOnTheScreen();
  expect(new Set(mockUseFriendship.mock.calls.map(([profileId]) => profileId))).toEqual(new Set(["stranger"]));
  expect(mockUseFriendship).toHaveBeenCalledWith("stranger", ready, undefined);
  await fireEvent.press(screen.getByRole("button", { name: "Add" }));
  expect(mockAct).toHaveBeenCalledWith("request");
});

it("hands a relationship the list already holds to the friendship hook", async () => {
  const ready = {
    ...guest,
    status: "ready" as const,
    profileId: "me" as never,
  };
  const relationship = {
    data: {
      state: "pending" as const,
      requesterId: "me" as never,
      blocked: false,
      revision: 1,
      blockRevision: 0,
    },
    refresh: jest.fn(),
  };
  mockState = relationship.data;
  await render(<CompactFriendshipControls profileId={"asked" as never} session={ready} relationship={relationship} />);
  expect(mockUseFriendship).toHaveBeenCalledWith("asked", ready, relationship);
  expect(screen.getByRole("button", { name: "Requested" })).toBeOnTheScreen();
});

it("refreshes friend lists only after accepting a request succeeds", async () => {
  const changed = jest.fn();
  mockState = {
    state: "pending",
    requesterId: "friend",
    blocked: false,
    revision: 0,
  };
  mockAct.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await render(
    <CompactFriendshipControls
      profileId={"friend" as never}
      session={{ ...guest, status: "ready", profileId: "me" as never }}
      onChanged={changed}
    />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "Accept" }));
  expect(changed).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Accept" }));
  expect(mockAct).toHaveBeenCalledWith("accept");
  expect(changed).toHaveBeenCalledTimes(1);
});
