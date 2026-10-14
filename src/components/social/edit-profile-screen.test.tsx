import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ConvexError } from "convex/values";
import { Alert } from "react-native";

import { switchOwner } from "@/lib/account/owner-store";
import { chooseProfilePhoto, profilePhotoBytes } from "@/lib/social/profile-photo";

import { EditProfileForm, EditProfileScreen } from "./edit-profile-screen";

const mockSave = jest.fn();
const mockBack = jest.fn();
const mockAvailable = jest.fn();
const mockMine = jest.fn();
const mockSetSafetyChecks = jest.fn();
jest.mock("convex/react", () => ({
  ...jest.requireActual("convex/react"),
  useAction: () => mockSave,
  useMutation: () => mockSetSafetyChecks,
}));
jest.mock("expo-router", () => ({
  router: { back: () => mockBack() },
  Stack: jest.requireActual("@/components/stack-toolbar-mock").mockStack,
}));
const mockTagSearch = jest.fn();
jest.mock("@convex-dev/auth/react", () => ({ useAuthToken: () => "token-a" }));
jest.mock("expo-network", () => ({ useNetworkState: () => ({ isConnected: true }) }));
jest.mock("@/lib/use-device-ready", () => ({ useDeviceReady: () => true }));
jest.mock("@/lib/social/use-social-query", () => ({
  useSocialQuery: (query: never, args: { username: string } | { prefix: string } | "skip") => {
    if (args === "skip") return { loading: false };
    switch (jest.requireActual("convex/server").getFunctionName(query)) {
      case "accounts:me":
        return {
          data: {
            linked: true,
            accountId: "a",
            profileId: "profile",
            claimComplete: true,
            scope: "scope-a",
            safetyChecks: true,
          },
        };
      case "profiles:mine":
        return { data: mockMine() };
      case "tags:search":
        return { data: mockTagSearch(args), loading: false };
      default:
        return { data: mockAvailable((args as { username: string }).username), loading: false };
    }
  },
}));
jest.mock("@/lib/social/profile-photo", () => ({
  chooseProfilePhoto: jest.fn(),
  profilePhotoBytes: jest.fn(),
  removeProfilePhotoDraft: jest.fn(),
}));
const profile = {
  profileId: "profile" as never,
  username: "alex",
  name: "Alex Morgan",
  avatar: "vermeer" as const,
  publishedWallCount: 2,
  photoUrl: "https://example.com/avatar.jpg",
};
beforeEach(() => {
  jest.clearAllMocks();
  mockSave.mockResolvedValue(profile);
  mockAvailable.mockReturnValue(true);
  mockMine.mockReturnValue(profile);
  switchOwner("account:a", "scope-a");
});

it("keeps a profile draft and its pending save when startup sync restores the same account's scope", async () => {
  switchOwner("account:a");
  let finish!: (saved: typeof profile) => void;
  mockSave.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render(<EditProfileScreen />);
  await fireEvent.changeText(screen.getByLabelText("Name"), "Alex Chen");
  await fireEvent.changeText(screen.getByLabelText("Bio"), "Art in the city.");
  await fireEvent.press(screen.getByRole("button", { name: "Save changes" }));
  await act(() => switchOwner("account:a", "scope-a"));
  expect(screen.getByLabelText("Name")).toHaveDisplayValue("Alex Chen");
  expect(screen.getByLabelText("Bio")).toHaveTextContent("Art in the city.");
  await act(() => finish(profile));
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it("saves trimmed profile text while preserving an unchanged photo and username", async () => {
  mockAvailable.mockReturnValue(false);
  await render(<EditProfileForm profile={profile} scope="account:a" safetyChecks />);
  expect(screen.getByText("Friends and your profile QR code keep working if you change it.")).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("Name"), " Alex Chen ");
  await fireEvent.changeText(screen.getByLabelText("Bio"), " A love of art. ");
  await fireEvent.press(screen.getByRole("button", { name: "Save changes" }));
  expect(mockSave).toHaveBeenCalledWith({
    name: "Alex Chen",
    bio: "A love of art.",
  });
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it("keeps an existing bio unsent while safety checks are off and offers to turn them on", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  await render(
    <EditProfileForm profile={{ ...profile, bio: "Prints and posters." }} scope="account:a" safetyChecks={false} />,
  );
  expect(screen.queryByLabelText("Bio")).toBeNull();
  expect(screen.getByText("Prints and posters.")).toBeOnTheScreen();
  expect(screen.getByText("Turn on safety checks to edit your bio.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Turn on" }));
  expect(alert).toHaveBeenCalledWith(
    "Turn on safety checks?",
    expect.any(String),
    expect.any(Array),
    expect.anything(),
  );
  await fireEvent.changeText(screen.getByLabelText("Name"), "Alex Chen");
  await fireEvent.press(screen.getByRole("button", { name: "Save changes" }));
  expect(mockSave).toHaveBeenCalledWith({ name: "Alex Chen" });
  alert.mockRestore();
});

it("suggests tags in use while a bio's tag is typed and saves the chosen one", async () => {
  jest.useFakeTimers();
  mockTagSearch.mockReturnValue([{ tag: "impressionism", postCount: 5 }]);
  await render(<EditProfileForm profile={profile} scope="account:a" safetyChecks />);
  const bio = screen.getByLabelText("Bio");
  await fireEvent.changeText(bio, "Loves #imp");
  await fireEvent(bio, "selectionChange", { nativeEvent: { selection: { start: 10, end: 10 } } });
  await act(() => jest.advanceTimersByTime(200));
  expect(mockTagSearch).toHaveBeenLastCalledWith({ prefix: "imp" });
  await fireEvent.press(screen.getByRole("button", { name: "#impressionism, 5 posts" }));
  expect(screen.getByLabelText("Bio")).toHaveTextContent("Loves #impressionism");
  jest.useRealTimers();
  await fireEvent.press(screen.getByRole("button", { name: "Save changes" }));
  expect(mockSave).toHaveBeenCalledWith({ name: "Alex Morgan", bio: "Loves #impressionism" });
});

it("keeps a rename made elsewhere while the form is open", async () => {
  const view = await render(<EditProfileForm profile={profile} scope="account:a" safetyChecks />);
  await view.rerender(
    <EditProfileForm profile={{ ...profile, username: "alex_elsewhere" }} scope="account:a" safetyChecks />,
  );
  expect(screen.getByText("Friends and your profile QR code keep working if you change it.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Save changes" }));
  expect(mockSave).toHaveBeenCalledWith({ name: "Alex Morgan", bio: "" });
});

it("renames the username after normalizing what was typed", async () => {
  await render(<EditProfileForm profile={profile} scope="account:a" safetyChecks />);
  await fireEvent.changeText(screen.getByLabelText("Username"), "Alex Chen");
  expect(await screen.findByText("Username available")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Save changes" }));
  expect(mockSave).toHaveBeenCalledWith({
    name: "Alex Morgan",
    bio: "",
    username: "alexchen",
  });
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it("blocks saving a username someone else has", async () => {
  mockAvailable.mockImplementation((username: string) => username !== "taken_name");
  await render(<EditProfileForm profile={profile} scope="account:a" safetyChecks />);
  await fireEvent.changeText(screen.getByLabelText("Username"), "taken_name");
  expect(await screen.findByText("That username is taken. Try another.")).toBeOnTheScreen();
  const save = screen.getByRole("button", { name: "Save changes" });
  expect(save).toBeDisabled();
  await fireEvent.press(save);
  expect(mockSave).not.toHaveBeenCalled();
});

it("blocks an offensive or staff username without asking the server", async () => {
  await render(<EditProfileForm profile={profile} scope="account:a" safetyChecks />);
  for (const username of ["fuck_you", "artlog_support", "alex-morgan"]) {
    await fireEvent.changeText(screen.getByLabelText("Username"), username);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  }
  expect(screen.getByText("Use 3–30 lowercase letters, numbers or underscores.")).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("Username"), "fuck_you");
  expect(screen.getByText("That username isn’t allowed. Try another.")).toBeOnTheScreen();
  expect(mockAvailable).not.toHaveBeenCalled();
});

it("shows why the server refused an offensive name", async () => {
  mockSave.mockRejectedValue(new ConvexError({ code: "profile_not_allowed" }));
  await render(<EditProfileForm profile={profile} scope="account:a" safetyChecks />);
  await fireEvent.changeText(screen.getByLabelText("Name"), "Shithead");
  await fireEvent.press(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByText("That name, username, or bio isn’t allowed. Try different words.")).toBeOnTheScreen();
  expect(mockBack).not.toHaveBeenCalled();
});

it("swaps the photo for a painting and keeps the choice after a save failure", async () => {
  mockSave.mockRejectedValue(new Error("offline"));
  await render(<EditProfileForm profile={profile} scope="account:a" safetyChecks />);
  await fireEvent.press(screen.getByRole("button", { name: "Change picture" }));
  await fireEvent.press(screen.getByRole("button", { name: "Senecio, Paul Klee" }));
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  await fireEvent.press(screen.getByRole("button", { name: "Save changes" }));
  expect(mockSave).toHaveBeenCalledWith({ name: "Alex Morgan", bio: "", avatar: "klee", photo: null });
  expect(screen.getByText(/Your profile was not saved/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Retry save" }));
  expect(mockSave).toHaveBeenLastCalledWith({ name: "Alex Morgan", bio: "", avatar: "klee", photo: null });
  expect(mockBack).not.toHaveBeenCalled();
});

it("does not upload a selected photo into a different account after preparation", async () => {
  jest.mocked(chooseProfilePhoto).mockResolvedValue("file:///draft.jpg");
  let finish!: (bytes: ArrayBuffer) => void;
  jest.mocked(profilePhotoBytes).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render(<EditProfileForm profile={profile} scope="account:a" safetyChecks />);
  await fireEvent.press(screen.getByRole("button", { name: "Change picture" }));
  await fireEvent.press(screen.getByRole("button", { name: "Choose photo" }));
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  await fireEvent.press(screen.getByRole("button", { name: "Save changes" }));
  await act(() => switchOwner("account:b", "scope-b"));
  await act(() => finish(new ArrayBuffer(3)));
  expect(mockSave).not.toHaveBeenCalled();
});

it("blocks picture changes while a save is in flight", async () => {
  let finish!: (saved: typeof profile) => void;
  mockSave.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render(<EditProfileForm profile={profile} scope="account:a" safetyChecks />);
  await fireEvent.press(screen.getByRole("button", { name: "Save changes" }));
  expect(screen.getByRole("button", { name: "Change picture" })).toBeDisabled();
  await act(() => finish(profile));
  expect(mockBack).toHaveBeenCalledTimes(1);
});
