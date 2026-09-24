import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { switchOwner } from "@/lib/account/owner-store";
import { chooseProfilePhoto, profilePhotoBytes } from "@/lib/social/profile-photo";

import { EditProfileForm } from "./edit-profile-screen";

const mockSave = jest.fn();
const mockBack = jest.fn();
jest.mock("convex/react", () => ({
  ...jest.requireActual("convex/react"),
  useAction: () => mockSave,
}));
jest.mock("expo-router", () => {
  const { Pressable, Text } = jest.requireActual("react-native");
  const Toolbar = ({ children }: { children: React.ReactNode }) => children;
  Toolbar.View = Toolbar;
  Toolbar.Button = function ToolbarButton({
    children,
    onPress,
    disabled,
  }: {
    children: string;
    onPress: () => void;
    disabled?: boolean;
  }) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        onPress={onPress}
      >
        <Text>{children}</Text>
      </Pressable>
    );
  };
  return { router: { back: () => mockBack() }, Stack: { Toolbar } };
});
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
  switchOwner("account:a", "scope-a");
});

it("saves trimmed profile text while preserving an unchanged photo", async () => {
  await render(<EditProfileForm profile={profile} />);
  await fireEvent.changeText(screen.getByLabelText("Name"), " Alex Chen ");
  await fireEvent.changeText(screen.getByLabelText("Introduction"), " A love of art. ");
  await fireEvent.press(screen.getByRole("button", { name: "Save changes" }));
  expect(mockSave).toHaveBeenCalledWith({
    name: "Alex Chen",
    bio: "A love of art.",
  });
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it("removes the photo explicitly and preserves the draft after a save failure", async () => {
  mockSave.mockRejectedValue(new Error("offline"));
  await render(<EditProfileForm profile={profile} />);
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
  await render(<EditProfileForm profile={profile} />);
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
  await render(<EditProfileForm profile={profile} />);
  await fireEvent.press(screen.getByRole("button", { name: "Save changes" }));
  const change = screen.getByRole("button", { name: "Change photo" });
  expect(change).toBeDisabled();
  await fireEvent.press(change);
  expect(chooseProfilePhoto).not.toHaveBeenCalled();
  await act(() => finish(profile));
  expect(mockBack).toHaveBeenCalledTimes(1);
});
