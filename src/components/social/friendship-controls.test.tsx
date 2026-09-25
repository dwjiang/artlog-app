import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Alert } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import type { SocialSession } from "@/lib/social/use-social-session";

import { CompactFriendshipControls, FriendshipControls } from "./friendship-controls";

const mockPush = jest.fn();
const mockAct = jest.fn();
const mockUseFriendship = jest.fn();
jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));
let mockState: object | undefined;
jest.mock("@/lib/social/use-friendship", () => ({
  useFriendship: (...args: unknown[]) => {
    mockUseFriendship(...args);
    return { act: mockAct, state: mockState };
  },
}));
const guest: SocialSession = {
  status: "signed-out",
  key: "guest",
  token: null,
  profileId: undefined,
  accountReady: false,
  offline: false,
  error: undefined,
  refresh: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAct.mockResolvedValue(true);
  mockState = undefined;
});

it("lets guests request sign-in from the friend action without sending a request", async () => {
  await render(<FriendshipControls profileId={"friend" as never} session={guest} />);
  expect(mockPush).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Add friend" }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/sign-in",
    params: { context: "friends" },
  });
  expect(mockAct).not.toHaveBeenCalled();
});

it("continues to profile setup after sign-in without sending a request automatically", async () => {
  await render(
    <FriendshipControls
      profileId={"friend" as never}

      session={{ ...guest, status: "profile-required" }}
    />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "Add friend" }));
  expect(mockPush).toHaveBeenCalledWith("/create-profile");
  expect(mockAct).not.toHaveBeenCalled();
});

it("keeps friendship actions unavailable while offline", async () => {
  await render(
    <FriendshipControls
      profileId={"friend" as never}

      session={{ ...guest, status: "offline", offline: true }}
    />,
  );
  expect(screen.queryByRole("button", { name: "Add friend" })).toBeNull();
});

it("requires confirmation before removing an existing friend", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  mockState = { state: "accepted", blocked: false };
  await render(
    <FriendshipControls
      profileId={"friend" as never}

      session={{ ...guest, status: "ready", profileId: "me" as never }}
    />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "Remove friend" }));
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
      profileId={"friend" as never}

      session={{ ...guest, status: "ready", profileId: "me" as never }}
    />,
  );
  expect(screen.getAllByRole("button")).toHaveLength(1);
  await fireEvent.press(screen.getByRole("button", { name: "Friend request sent" }));
  expect(mockAct).toHaveBeenCalledWith("cancel");
});

it("labels the answers to a received request as accepting or ignoring a friend", async () => {
  mockState = { state: "pending", requesterId: "friend", blocked: false, revision: 1 };
  await render(
    <FriendshipControls
      profileId={"friend" as never}

      session={{ ...guest, status: "ready", profileId: "me" as never }}
    />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "Ignore" }));
  expect(mockAct).toHaveBeenCalledWith("decline");
  await fireEvent.press(screen.getByRole("button", { name: "Accept friend" }));
  expect(mockAct).toHaveBeenCalledWith("accept");
});

it("keeps the trailing action beside every friendship state", async () => {
  const share = <GalleryButton label="Share profile" onPress={() => {}} />;
  const ready = { ...guest, status: "ready" as const, profileId: "me" as never };
  const view = await render(<FriendshipControls profileId={"friend" as never} session={guest} trailing={share} />);
  expect(screen.getByRole("button", { name: "Add friend" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Share profile" })).toBeOnTheScreen();
  await view.rerender(<FriendshipControls profileId={"friend" as never} session={ready} trailing={share} />);
  expect(screen.getByLabelText("Loading friendship…")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Share profile" })).toBeOnTheScreen();
  mockState = { state: "pending", requesterId: "friend", blocked: false, revision: 1 };
  await view.rerender(<FriendshipControls profileId={"friend" as never} session={ready} trailing={share} />);
  expect(screen.getAllByRole("button").map((button) => button.props.accessibilityLabel)).toEqual([
    "Accept friend",
    "Ignore",
    "Share profile",
  ]);
  mockState = { state: "accepted", blocked: false };
  await view.rerender(<FriendshipControls profileId={"friend" as never} session={ready} trailing={share} />);
  expect(screen.getByRole("button", { name: "Remove friend" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Share profile" })).toBeOnTheScreen();
});

it("renders a known friend row without a relationship query and lets a stranger be added", async () => {
  mockState = { state: "none", blocked: false, revision: 0 };
  const ready = {
    ...guest,
    status: "ready" as const,
    profileId: "me" as never,
  };
  await render(
    <>
      <CompactFriendshipControls profileId={"friend" as never} session={ready} friend />
      <CompactFriendshipControls profileId={"stranger" as never} session={ready} />
    </>,
  );
  expect(screen.getByText("Friends")).toBeOnTheScreen();
  expect(mockUseFriendship).toHaveBeenCalledTimes(1);
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
