import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { getFunctionName as mockGetFunctionName } from "convex/server";

import { removeSetting } from "@/db/repos/settings";
import { setLocalProfileName } from "@/lib/account/local-profile";
import { anonymousOwner, switchOwner } from "@/lib/account/owner-store";

import { CollectionHeader } from "./collection-header";

const mockPush = jest.fn();
jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useRouter: () => ({ push: mockPush }),
}));
let mockSession: { status: string; key: string; profileId?: string } = { status: "signed-out", key: "guest" };
let mockProfile: object | undefined;
let mockFriends: object[] = [];
jest.mock("@/lib/social/use-social-session", () => ({
  useSocialSession: () => mockSession,
}));
jest.mock("@/lib/social/use-social-query", () => ({
  useSocialQuery: (query: Parameters<typeof mockGetFunctionName>[0], args: unknown) => ({
    data: args === "skip" ? undefined : mockGetFunctionName(query) === "profiles:friends" ? mockFriends : mockProfile,
    loading: false,
  }),
}));

beforeEach(async () => {
  jest.clearAllMocks();
  await removeSetting("local-profile-name");
  switchOwner(anonymousOwner());
  mockSession = { status: "signed-out", key: "guest" };
  mockProfile = undefined;
  mockFriends = [];
});

it("does not report zero artworks before collection counts load", async () => {
  const view = await render(<CollectionHeader loading />);
  expect(screen.getByRole("progressbar", { name: "Loading counts" })).toBeOnTheScreen();
  expect(screen.queryByLabelText("0 artworks")).toBeNull();
  expect(screen.getByRole("button", { name: "Settings" })).toBeOnTheScreen();
  await view.rerender(<CollectionHeader artworkCount={3} visitCount={1} />);
  await screen.findByRole("header", { name: "Guest" });
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.getByLabelText("3 artworks")).toBeOnTheScreen();
  expect(screen.getByLabelText("1 visit")).toBeOnTheScreen();
});

it("shows the saved name in the shared profile header and opens settings", async () => {
  await setLocalProfileName("Alex Rivera");
  await render(<CollectionHeader artworkCount={3} visitCount={1} />);
  expect(await screen.findByRole("header", { name: "Alex Rivera" })).toBeOnTheScreen();
  // A guest's painting stands in for their initials.
  expect(screen.queryByText("AR", { includeHiddenElements: true })).toBeNull();
  expect(screen.queryByText("Saved on this iPhone")).toBeNull();
  expect(screen.getByLabelText("3 artworks")).toBeOnTheScreen();
  expect(screen.getByLabelText("1 visit")).toBeOnTheScreen();
  expect(screen.queryByText("No bio")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Settings" }));
  expect(mockPush).toHaveBeenCalledWith("/settings");
});

it("updates a mounted guest header when onboarding saves a name", async () => {
  await render(<CollectionHeader />);
  await screen.findByRole("header", { name: "Guest" });
  await act(() => setLocalProfileName("Alex"));
  expect(screen.getByRole("header", { name: "Alex" })).toBeOnTheScreen();
});

it.each([0, 1])("keeps account promotion out of the guest header with %i saved artworks", async (artworkCount) => {
  await render(<CollectionHeader artworkCount={artworkCount} />);
  expect(mockPush).not.toHaveBeenCalled();
  expect(screen.queryByText(/sign in|sync your collection/i)).toBeNull();
  expect(screen.queryByRole("button", { name: /sign in|create account|share/i })).toBeNull();
});

it("offers nothing to share from an empty guest collection", async () => {
  await render(<CollectionHeader />);
  expect(screen.getByLabelText("0 artworks")).toBeOnTheScreen();
  expect(screen.queryByLabelText(/friends?$/)).toBeNull();
  expect(screen.queryByText("YC", { includeHiddenElements: true })).toBeNull();
  expect(screen.queryByRole("button", { name: "Share your wall" })).toBeNull();
  expect(screen.getByRole("button", { name: "Settings" })).toBeEnabled();
});

describe("signed in", () => {
  beforeEach(() => {
    switchOwner("account:alex");
    mockSession = { status: "ready", key: "alex", profileId: "alex" };
  });

  it("shows your profile the way other people see it, with your collection counts", async () => {
    await setLocalProfileName("Local Alex");
    mockProfile = {
      profileId: "alex",
      name: "Alex Morgan",
      username: "alex",
      bio: "Slow afternoons in museums.",
      publishedWallCount: 2,
    };
    await render(<CollectionHeader artworkCount={13} visitCount={1} />);
    expect(screen.getByRole("header", { name: "Alex Morgan" })).toBeOnTheScreen();
    expect(screen.getByText("@alex")).toBeOnTheScreen();
    expect(screen.getByText("Slow afternoons in museums.")).toBeOnTheScreen();
    expect(screen.getByLabelText("13 artworks")).toBeOnTheScreen();
    expect(screen.getByLabelText("1 visit")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Edit Profile" }));
    expect(mockPush).toHaveBeenLastCalledWith("/edit-profile");
    await fireEvent.press(screen.getByRole("button", { name: "Share Profile" }));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/share-profile", params: { profileId: "alex" } });
    await fireEvent.press(screen.getByRole("button", { name: "Settings" }));
    expect(mockPush).toHaveBeenLastCalledWith("/settings");
    mockSession = { status: "signed-out", key: "guest" };
    await act(() => switchOwner(anonymousOwner()));
    expect(await screen.findByRole("header", { name: "Local Alex" })).toBeOnTheScreen();
    expect(screen.queryByText("@alex")).toBeNull();
  });

  it("counts your friends and opens them from the count", async () => {
    mockProfile = { profileId: "alex", name: "Alex Morgan", username: "alex", publishedWallCount: 0 };
    mockFriends = [{ profileId: "sam" }, { profileId: "kai" }];
    await render(<CollectionHeader artworkCount={13} visitCount={1} />);
    await fireEvent.press(screen.getByRole("button", { name: "2 friends" }));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/people", params: { filter: "friends" } });
  });

  it("holds the friend count’s place while your session resolves", async () => {
    mockSession = { status: "loading", key: "alex" };
    await render(<CollectionHeader artworkCount={13} visitCount={1} />);
    expect(screen.getByRole("progressbar", { name: "Loading counts" })).toBeOnTheScreen();
    expect(screen.getByText("friends", { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /friends?$/ })).toBeNull();
  });

  it("says so when your profile has no bio", async () => {
    mockProfile = { profileId: "alex", name: "Alex Morgan", username: "alex", publishedWallCount: 0 };
    await render(<CollectionHeader />);
    expect(screen.getByText("No bio")).toBeOnTheScreen();
  });

  it("holds the counts until the collection loads", async () => {
    await render(<CollectionHeader loading />);
    expect(screen.getByRole("progressbar", { name: "Opening profile…" })).toBeOnTheScreen();
    expect(screen.getByRole("progressbar", { name: "Loading counts" })).toBeOnTheScreen();
    expect(screen.queryByLabelText("0 artworks")).toBeNull();
    expect(screen.getByRole("button", { name: "Settings" })).toBeOnTheScreen();
  });

  it("offers profile creation in place of editing before a profile exists", async () => {
    mockSession = { status: "profile-required", key: "alex" };
    await render(<CollectionHeader artworkCount={1} />);
    expect(screen.getByText("Create a profile to share your wall")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Edit Profile" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Create profile" }));
    expect(mockPush).toHaveBeenLastCalledWith("/create-profile");
  });
});
