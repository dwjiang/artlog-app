import { fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import { GalleryButton } from "./gallery-button";

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
