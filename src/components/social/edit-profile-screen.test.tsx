import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { switchOwner } from "@/lib/account/owner-store";
import { chooseProfilePhoto, profilePhotoBytes } from "@/lib/social/profile-photo";

import { EditProfileForm } from "./edit-profile-screen";

const mockSave = jest.fn();
const mockBack = jest.fn();
const mockAvailable = jest.fn();
jest.mock("convex/react", () => ({
  ...jest.requireActual("convex/react"),
  useAction: () => mockSave,
}));
jest.mock("expo-router", () => ({
  router: { back: () => mockBack() },
  Stack: jest.requireActual("@/components/stack-toolbar-mock").mockStack,
}));
jest.mock("@/lib/social/use-social-query", () => ({
  useSocialQuery: (_query: unknown, args: { username: string } | "skip") =>
    args === "skip" ? { loading: false } : { data: mockAvailable(args.username), loading: false },
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
  publishedWallCount: 2,
  photoUrl: "https://example.com/avatar.jpg",
};
beforeEach(() => {
  jest.clearAllMocks();
  mockSave.mockResolvedValue(profile);
  mockAvailable.mockReturnValue(true);
  switchOwner("account:a", "scope-a");
});

it("saves trimmed profile text while preserving an unchanged photo and username", async () => {
  mockAvailable.mockReturnValue(false);
  await render(<EditProfileForm profile={profile} scope="account:a" />);
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

it("keeps a rename made elsewhere while the form is open", async () => {
  const view = await render(<EditProfileForm profile={profile} scope="account:a" />);
  await view.rerender(<EditProfileForm profile={{ ...profile, username: "alex-elsewhere" }} scope="account:a" />);
  expect(screen.getByText("Friends and your profile QR code keep working if you change it.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Save changes" }));
  expect(mockSave).toHaveBeenCalledWith({ name: "Alex Morgan", bio: "" });
});

it("renames the username after normalizing what was typed", async () => {
  await render(<EditProfileForm profile={profile} scope="account:a" />);
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
  mockAvailable.mockImplementation((username: string) => username !== "taken-name");
  await render(<EditProfileForm profile={profile} scope="account:a" />);
  await fireEvent.changeText(screen.getByLabelText("Username"), "taken-name");
  expect(await screen.findByText("That username is taken. Try another.")).toBeOnTheScreen();
  const save = screen.getByRole("button", { name: "Save changes" });
  expect(save).toBeDisabled();
  await fireEvent.press(save);
  expect(mockSave).not.toHaveBeenCalled();
});

it("removes the photo explicitly and preserves the draft after a save failure", async () => {
  mockSave.mockRejectedValue(new Error("offline"));
  await render(<EditProfileForm profile={profile} scope="account:a" />);
  await fireEvent.press(screen.getByRole("button", { name: "Remove photo" }));
  await fireEvent.press(screen.getByRole("button", { name: "Save changes" }));
  expect(mockSave).toHaveBeenCalledWith({
    name: "Alex Morgan",
    bio: "",
    photo: null,
  });
  expect(screen.getByText(/Your profile was not saved/)).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Add photo" })).toBeOnTheScreen();
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
  await render(<EditProfileForm profile={profile} scope="account:a" />);
  await fireEvent.press(screen.getByRole("button", { name: "Change photo" }));
  await fireEvent.press(screen.getByRole("button", { name: "Save changes" }));
  await act(() => switchOwner("account:b", "scope-b"));
  await act(() => finish(new ArrayBuffer(3)));
  expect(mockSave).not.toHaveBeenCalled();
});

it("blocks photo changes while a save is in flight", async () => {
  let finish!: (saved: typeof profile) => void;
  mockSave.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render(<EditProfileForm profile={profile} scope="account:a" />);
  await fireEvent.press(screen.getByRole("button", { name: "Save changes" }));
  const change = screen.getByRole("button", { name: "Change photo" });
  expect(change).toBeDisabled();
  await fireEvent.press(change);
  expect(chooseProfilePhoto).not.toHaveBeenCalled();
  await act(() => finish(profile));
  expect(mockBack).toHaveBeenCalledTimes(1);
});
