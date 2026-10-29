import { fireEvent, render, screen } from "@testing-library/react-native";
import * as ReactNative from "react-native";
import { AccessibilityInfo, StyleSheet } from "react-native";

import { EditBar } from "./sheet-controls";

// accessibility-extra-extra-extra-large, the largest text size.
const LARGEST_TEXT_SCALE = 3.12;

afterEach(() => jest.restoreAllMocks());

it("keeps Cancel, the title and the commit on one 44-pt row at the largest text size", async () => {
  jest
    .spyOn(ReactNative, "useWindowDimensions")
    .mockReturnValue({ ...ReactNative.Dimensions.get("window"), fontScale: LARGEST_TEXT_SCALE });
  await render(<EditBar title="Report Audio" onCancel={jest.fn()} commit={{ label: "Report", onPress: jest.fn() }} />);
  const cancel = screen.getByRole("button", { name: "Cancel" });
  const title = screen.getByRole("header", { name: "Report Audio" });
  const commit = screen.getByRole("button", { name: "Report" });
  expect(title.parent).toHaveStyle({ flexDirection: "row" });
  expect(title.parent?.children).toEqual([cancel, title, commit]);
  expect(title).toHaveProp("numberOfLines", 1);
  expect(title).toHaveProp("ellipsizeMode", "middle");
  for (const button of [cancel, commit]) expect(button).toHaveStyle({ minWidth: 44, minHeight: 44 });
  for (const text of [screen.getByText("Cancel"), title, screen.getByText("Report")]) {
    const scaledLine = StyleSheet.flatten(text.props.style).lineHeight * text.props.maxFontSizeMultiplier;
    expect(scaledLine).toBeLessThanOrEqual(44);
  }
});

it("cancels and commits only while each is enabled", async () => {
  const onCancel = jest.fn();
  const onSave = jest.fn();
  const bar = (disabled: boolean) => (
    <EditBar
      title="Profile Picture"
      cancelDisabled={disabled}
      onCancel={onCancel}
      commit={{ label: "Save", disabled, onPress: onSave }}
    />
  );
  await render(bar(true));
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  expect(onSave).not.toHaveBeenCalled();

  await screen.rerender(bar(false));
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onSave).toHaveBeenCalledTimes(1);
});

it("keeps a busy commit labeled in place, blocks repeat presses and announces progress", async () => {
  const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  const onPress = jest.fn();
  await render(
    <EditBar
      title="Send Feedback"
      onCancel={jest.fn()}
      commit={{ label: "Send", busy: true, busyLabel: "Sending…", onPress }}
    />,
  );
  const send = screen.getByRole("button", { name: "Send" });
  expect(send).toBeDisabled();
  expect(send).toBeBusy();
  expect(send).toHaveAccessibilityValue({ text: "Sending…" });
  expect(screen.getByText("Send")).toBeOnTheScreen();
  await fireEvent.press(send);
  expect(onPress).not.toHaveBeenCalled();
  expect(announce).toHaveBeenCalledWith("Send. In progress.");
});
