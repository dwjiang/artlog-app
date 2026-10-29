import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as ReactNative from "react-native";
import { Alert, type AlertButton } from "react-native";

import { chooseProfilePhoto, removeProfilePhotoDraft } from "@/lib/social/profile-photo";

import { ProfilePicturePicker } from "./profile-picture-picker";

jest.mock("@/lib/social/profile-photo", () => ({
  chooseProfilePhoto: jest.fn(),
  removeProfilePhotoDraft: jest.fn(),
}));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));

const onCancel = jest.fn();
const onSave = jest.fn();
let alert: jest.SpyInstance;
beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  jest.mocked(chooseProfilePhoto).mockResolvedValue("file:///cache/me.jpg");
  alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
const alertButton = (text: string) =>
  (alert.mock.lastCall as [string, undefined, AlertButton[]])[2].find((button) => button.text === text)!;
function picker(shown: { photoUrl?: string; avatar?: "vermeer" }, visible = true) {
  return <ProfilePicturePicker visible={visible} name="Alex" shown={shown} onCancel={onCancel} onSave={onSave} />;
}

it.each([1, 1.5, 3.1])("labels and saves a painting at %sx text size", async (fontScale) => {
  jest
    .spyOn(ReactNative, "useWindowDimensions")
    .mockReturnValue({ ...ReactNative.Dimensions.get("window"), fontScale });
  await render(picker({ avatar: "vermeer" }));
  expect(screen.getByRole("header", { name: "Profile Picture" })).toBeOnTheScreen();
  expect(screen.getByText("Girl with a Pearl Earring")).toBeOnTheScreen();
  expect(screen.getByText("Johannes Vermeer · c. 1665")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Girl with a Pearl Earring, Johannes Vermeer" })).toBeSelected();
  await fireEvent.press(screen.getByRole("button", { name: "Senecio, Paul Klee" }));
  expect(screen.getByText("Paul Klee · 1922")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Senecio, Paul Klee" })).toBeSelected();
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  expect(onSave).toHaveBeenCalledWith({ kind: "avatar", avatar: "klee" });
});

it("closes without a change when the shown picture is kept", async () => {
  await render(picker({ photoUrl: "https://example.com/me.jpg", avatar: "vermeer" }));
  expect(screen.getByText("Your photo")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Girl with a Pearl Earring, Johannes Vermeer" })).not.toBeSelected();
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onSave).not.toHaveBeenCalled();
});

it("closes without saving when the current painting is selected again", async () => {
  await render(picker({ avatar: "vermeer" }));
  await fireEvent.press(screen.getByRole("button", { name: "Girl with a Pearl Earring, Johannes Vermeer" }));
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onSave).not.toHaveBeenCalled();
});

it("hands a saved photo to the screen but deletes one that was dropped", async () => {
  const view = await render(picker({ avatar: "vermeer" }));
  await fireEvent.press(screen.getByRole("button", { name: "Choose photo" }));
  expect(await screen.findByText("Your photo")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  expect(onSave).toHaveBeenCalledWith({ kind: "photo", uri: "file:///cache/me.jpg" });
  await view.rerender(picker({ avatar: "vermeer" }, false));
  expect(removeProfilePhotoDraft).not.toHaveBeenCalledWith("file:///cache/me.jpg");

  await view.rerender(picker({ avatar: "vermeer" }));
  await fireEvent.press(screen.getByRole("button", { name: "Choose photo" }));
  await screen.findByText("Your photo");
  await fireEvent.press(screen.getByRole("button", { name: "Senecio, Paul Klee" }));
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  await act(() => alertButton("Discard Edits").onPress?.());
  expect(onCancel).toHaveBeenCalledTimes(1);
  await view.rerender(picker({ avatar: "vermeer" }, false));
  expect(removeProfilePhotoDraft).toHaveBeenCalledWith("file:///cache/me.jpg");
});

it("cancels at once while the shown picture is still chosen", async () => {
  await render(picker({ avatar: "vermeer" }));
  await fireEvent.press(screen.getByRole("button", { name: "Senecio, Paul Klee" }));
  await fireEvent.press(screen.getByRole("button", { name: "Girl with a Pearl Earring, Johannes Vermeer" }));
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(alert).not.toHaveBeenCalled();
});

it("asks before Cancel drops a newly chosen picture", async () => {
  await render(picker({ photoUrl: "https://example.com/me.jpg", avatar: "vermeer" }));
  await fireEvent.press(screen.getByRole("button", { name: "Senecio, Paul Klee" }));
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(alert).toHaveBeenCalledWith("Discard your edits?", undefined, expect.any(Array));
  await act(() => alertButton("Keep Editing").onPress?.());
  expect(onCancel).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Senecio, Paul Klee" })).toBeSelected();
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  await act(() => alertButton("Discard Edits").onPress?.());
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onSave).not.toHaveBeenCalled();
});
