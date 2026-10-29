import { fireEvent, render, screen, within } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import { dynamicTypeSizeCaps } from "@/components/dynamic-type-test-utils";

import { GalleryButton } from "./gallery-button";

it("hides private labels from replay while preserving the accessible action", async () => {
  const onPress = jest.fn();
  await render(<GalleryButton label="Private artwork · Private artist" maskInReplay onPress={onPress} />);
  const button = within(screen.getByTestId("replay-mask")).getByRole("button", {
    name: "Private artwork · Private artist",
  });
  await fireEvent.press(button);
  expect(onPress).toHaveBeenCalledTimes(1);

  await screen.rerender(<GalleryButton label="Save details" onPress={onPress} />);
  expect(screen.getByRole("button", { name: "Save details" })).toBeOnTheScreen();
  expect(screen.queryByTestId("replay-mask")).toBeNull();
});

it("keeps its label and prevents duplicate activation while announcing progress", async () => {
  const onPress = jest.fn();
  const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  await render(<GalleryButton label="Save artwork" onPress={onPress} />);
  await fireEvent.press(screen.getByRole("button", { name: "Save artwork" }));
  expect(onPress).toHaveBeenCalledTimes(1);

  await screen.rerender(<GalleryButton label="Save artwork" onPress={onPress} busy busyLabel="Saving…" fullWidth />);
  const button = screen.getByRole("button", {
    name: "Save artwork",
    disabled: true,
  });
  expect(screen.getByText("Save artwork")).toBeOnTheScreen();
  await fireEvent.press(button);
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Saving…", { includeHiddenElements: true })).toBeNull();
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(announce).toHaveBeenCalledWith("Save artwork. In progress.");

  await screen.rerender(<GalleryButton label="Save artwork" onPress={onPress} />);
  expect(screen.getByRole("button", { name: "Save artwork", disabled: false })).toBeOnTheScreen();
  announce.mockRestore();
});

it("reserves its native minimum size before SwiftUI first sizes the host", async () => {
  await render(<GalleryButton label="Edit profile" variant="outlined" fullWidth onPress={jest.fn()} />);
  expect(screen.getByRole("button", { name: "Edit profile" }).parent).toHaveStyle({ minHeight: 44, width: "100%" });
  await screen.rerender(<GalleryButton label="Save" variant="filled" fullWidth onPress={jest.fn()} />);
  expect(screen.getByRole("button", { name: "Save" }).parent).toHaveStyle({ minHeight: 52 });
  await screen.rerender(<GalleryButton label="Edit Wall" icon="pencil" iconOnly onPress={jest.fn()} />);
  expect(screen.getByRole("button", { name: "Edit Wall" }).parent).toHaveStyle({ minHeight: 44, minWidth: 44 });
});

it("follows Dynamic Type without limit unless the caller sets a ceiling", async () => {
  await render(<GalleryButton label="Save" onPress={jest.fn()} />);
  expect(dynamicTypeSizeCaps(screen.getByText("Save"))).toEqual([]);
  await screen.rerender(<GalleryButton label="Edit profile" maxTypeSize="xxxLarge" onPress={jest.fn()} />);
  expect(dynamicTypeSizeCaps(screen.getByText("Edit profile"))).toEqual([expect.objectContaining({ max: "xxxLarge" })]);
});
