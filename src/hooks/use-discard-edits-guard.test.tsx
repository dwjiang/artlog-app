import { act, fireEvent, screen } from "@testing-library/react-native";
import { router } from "expo-router";
import { Stack } from "expo-router/stack";
import { renderRouter } from "expo-router/testing-library";
import { useState } from "react";
import { Alert, Pressable, Text, type AlertButton } from "react-native";

import { useDiscardEditsGuard } from "./use-discard-edits-guard";

let mockBusy = false;

function EditRoute() {
  const [edited, setEdited] = useState(false);
  const leave = useDiscardEditsGuard({ edited, busy: mockBusy });
  return (
    <>
      <Pressable accessibilityRole="button" onPress={() => setEdited(true)}>
        <Text>Edit</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.back()}>
        <Text>Cancel</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => leave()}>
        <Text>Save</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => leave(() => router.replace("/all-artworks"))}>
        <Text>Merge</Text>
      </Pressable>
    </>
  );
}

const open = async () => {
  const view = await renderRouter(
    {
      _layout: () => <Stack />,
      index: () => <Text>Profile</Text>,
      "all-artworks": () => <Text>All artworks</Text>,
      "edit-profile": EditRoute,
    },
    { initialUrl: "/" },
  );
  await act(() => router.push("/edit-profile"));
  return view;
};
const alertButton = (alert: jest.SpyInstance, text: string) =>
  (alert.mock.lastCall as [string, undefined, AlertButton[]])[2].find((button) => button.text === text)!;

let alert: jest.SpyInstance;
beforeEach(() => {
  mockBusy = false;
  alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
afterEach(() => alert.mockRestore());

it("closes without asking while nothing was edited", async () => {
  const view = await open();
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(view.getPathname()).toBe("/");
  expect(alert).not.toHaveBeenCalled();
});

it("asks before discarding edits and stays open to keep editing", async () => {
  const view = await open();
  await fireEvent.press(screen.getByRole("button", { name: "Edit" }));
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(alert).toHaveBeenCalledWith("Discard your edits?", undefined, expect.any(Array));
  expect(view.getPathname()).toBe("/edit-profile");
  expect(alertButton(alert, "Keep Editing").style).toBe("cancel");
  await act(() => alertButton(alert, "Keep Editing").onPress?.());
  expect(view.getPathname()).toBe("/edit-profile");

  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  const discard = alertButton(alert, "Discard Edits");
  expect(discard.style).toBe("destructive");
  await act(() => discard.onPress?.());
  expect(view.getPathname()).toBe("/");
});

it("closes after a save without asking", async () => {
  const view = await open();
  await fireEvent.press(screen.getByRole("button", { name: "Edit" }));
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  expect(view.getPathname()).toBe("/");
  expect(alert).not.toHaveBeenCalled();
});

it("goes elsewhere without asking for a commit that leaves by its own route", async () => {
  const view = await open();
  await fireEvent.press(screen.getByRole("button", { name: "Edit" }));
  await fireEvent.press(screen.getByRole("button", { name: "Merge" }));
  expect(view.getPathname()).toBe("/all-artworks");
  expect(alert).not.toHaveBeenCalled();
});

it("stays open without offering to discard while a save is in flight", async () => {
  mockBusy = true;
  const view = await open();
  await act(() => router.back());
  expect(view.getPathname()).toBe("/edit-profile");
  expect(alert).not.toHaveBeenCalled();
});
