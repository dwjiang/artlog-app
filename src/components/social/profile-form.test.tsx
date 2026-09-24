import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ProfileForm } from "./profile-form";
import { switchOwner } from "@/lib/account/owner-store";
import {
  chooseProfilePhoto,
  profilePhotoBytes,
} from "@/lib/social/profile-photo";

const mockCreate = jest.fn(),
  mockSavePhoto = jest.fn();
jest.mock("convex/react", () => ({
  useMutation: () => mockCreate,
  useAction: () => mockSavePhoto,
}));
jest.mock("@/lib/social/use-social-session", () => ({
  useSocialSession: () => ({ key: "account:a" }),
}));
jest.mock("@/lib/social/use-social-query", () => ({
  useSocialQuery: () => ({ data: true }),
}));
jest.mock("@/lib/social/profile-photo", () => ({
  chooseProfilePhoto: jest.fn(),
  profilePhotoBytes: jest.fn(),
  removeProfilePhotoDraft: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  switchOwner("account:a", "scope-a");
  mockCreate.mockResolvedValue({});
  mockSavePhoto.mockResolvedValue({});
  jest.mocked(chooseProfilePhoto).mockResolvedValue("file:///profile.jpg");
  jest.mocked(profilePhotoBytes).mockResolvedValue(new ArrayBuffer(3));
});
async function prepare(onCreated = jest.fn()) {
  await render(
    <ProfileForm introduction="Create your profile." onCreated={onCreated} />,
  );
  await fireEvent.changeText(screen.getByLabelText("Name"), " Alex ");
  await fireEvent.changeText(screen.getByLabelText("Username"), "alex");
  await fireEvent.press(screen.getByRole("button", { name: "Add a photo" }));
  return onCreated;
}
it("creates the profile before uploading its selected photo and completing setup", async () => {
  const onCreated = await prepare();
  await fireEvent.press(
    screen.getByRole("button", { name: "Create public profile" }),
  );
  expect(mockCreate).toHaveBeenCalledWith({
    name: "Alex",
    username: "alex",
    bio: "",
  });
  expect(mockSavePhoto).toHaveBeenCalledWith({
    name: "Alex",
    bio: "",
    photo: new ArrayBuffer(3),
  });
  expect(mockCreate.mock.invocationCallOrder[0]).toBeLessThan(
    mockSavePhoto.mock.invocationCallOrder[0],
  );
  expect(onCreated).toHaveBeenCalledTimes(1);
});
it("retries a failed photo upload without creating the profile twice", async () => {
  mockSavePhoto.mockRejectedValueOnce(new Error("offline"));
  const onCreated = await prepare();
  await fireEvent.press(
    screen.getByRole("button", { name: "Create public profile" }),
  );
  expect(
    screen.getByRole("button", { name: "Continue without photo" }),
  ).toBeOnTheScreen();
  expect(onCreated).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(mockSavePhoto).toHaveBeenCalledTimes(2);
  expect(onCreated).toHaveBeenCalledTimes(1);
});
it("does not create or upload into another account after preparing the photo", async () => {
  let finish!: (bytes: ArrayBuffer) => void;
  jest.mocked(profilePhotoBytes).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const onCreated = await prepare();
  await fireEvent.press(
    screen.getByRole("button", { name: "Create public profile" }),
  );
  await act(() => switchOwner("account:b", "scope-b"));
  await act(() => finish(new ArrayBuffer(3)));
  expect(mockCreate).not.toHaveBeenCalled();
  expect(mockSavePhoto).not.toHaveBeenCalled();
  expect(onCreated).not.toHaveBeenCalled();
});
