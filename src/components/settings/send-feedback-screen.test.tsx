import { act, fireEvent, screen } from "@testing-library/react-native";
import { ConvexError } from "convex/values";
import { router } from "expo-router";
import { Stack } from "expo-router/stack";
import { renderRouter } from "expo-router/testing-library";
import * as ReactNative from "react-native";
import { Alert, ScrollView, Text, type AlertButton } from "react-native";

import { SendFeedbackScreen } from "./send-feedback-screen";

const mockSubmit = jest.fn();
const mockToast = jest.fn();
const mockErrorToast = jest.fn();
let mockOffline = false;
jest.mock("convex/react", () => ({
  ...jest.requireActual("convex/react"),
  useMutation: () => mockSubmit,
}));
jest.mock("expo-network", () => ({
  getNetworkStateAsync: async () => ({ isConnected: !mockOffline, isInternetReachable: !mockOffline }),
}));
jest.mock("@/components/toast", () => ({ ToastLayer: () => null }));
jest.mock("@/lib/use-device-ready", () => ({ useDeviceReady: () => true }));
jest.mock("@/lib/ui/toast", () => ({
  showToast: (...args: unknown[]) => mockToast(...args),
  showErrorToast: (...args: unknown[]) => mockErrorToast(...args),
}));

let alert: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockSubmit.mockResolvedValue(null);
  mockOffline = false;
  alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const open = async () => {
  const view = await renderRouter(
    { _layout: () => <Stack />, index: () => <Text>Settings</Text>, "send-feedback": SendFeedbackScreen },
    { initialUrl: "/" },
  );
  await act(() => router.push("/send-feedback"));
  await screen.findByLabelText("Feedback");
  return view;
};
async function sendFeedback(text: string) {
  await fireEvent.changeText(screen.getByLabelText("Feedback"), text);
  await fireEvent.press(screen.getByRole("button", { name: "Send" }));
}
async function retry() {
  const [, onRetry] = mockErrorToast.mock.lastCall as [string, () => void];
  await act(async () => onRetry());
}
const alertButton = (text: string) =>
  (alert.mock.lastCall as [string, undefined, AlertButton[]])[2].find((button) => button.text === text)!;

it("sends the trimmed message with app details, then closes", async () => {
  const view = await open();
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  await sendFeedback("  Let me sort the wall by date. ");
  expect(mockSubmit).toHaveBeenCalledWith({
    message: "Let me sort the wall by date.",
    appVersion: expect.any(String),
    osVersion: expect.stringMatching(/^iOS /),
  });
  expect(mockToast).toHaveBeenCalledWith("Feedback sent. Thank you.");
  expect(view.getPathname()).toBe("/");
  expect(alert).not.toHaveBeenCalled();
});

it("pins one Cancel | title | Send bar over the message at the largest text size", async () => {
  jest
    .spyOn(ReactNative, "useWindowDimensions")
    .mockReturnValue({ ...ReactNative.Dimensions.get("window"), fontScale: 3.12 });
  await open();
  const title = screen.getByRole("header", { name: "Send Feedback" });
  const bar = title.parent;
  expect(bar?.children).toEqual([
    screen.getByRole("button", { name: "Cancel" }),
    title,
    screen.getByRole("button", { name: "Send" }),
  ]);
  // The bar is the scroll view's sticky first item, so the message scrolls under it and the bar stays.
  const content = bar?.parent;
  expect(content?.children[0]).toBe(bar);
  expect(content?.parent).toHaveProp("stickyHeaderIndices", [0]);
});

it("closes without asking while the message is blank", async () => {
  const view = await open();
  await fireEvent.changeText(screen.getByLabelText("Feedback"), "  ");
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(view.getPathname()).toBe("/");
  expect(alert).not.toHaveBeenCalled();
});

it("asks before Cancel or a swipe throws a typed message away, and keeps it to keep editing", async () => {
  const view = await open();
  await fireEvent.changeText(screen.getByLabelText("Feedback"), "The globe is slow.\nAnd the map too.");
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(alert).toHaveBeenCalledWith("Discard your edits?", undefined, expect.any(Array));
  expect(view.getPathname()).toBe("/send-feedback");
  await act(() => alertButton("Keep Editing").onPress?.());
  expect(screen.getByLabelText("Feedback")).toHaveDisplayValue("The globe is slow.\nAnd the map too.");

  // A swipe down removes the sheet the same way the back action does.
  await act(() => router.back());
  expect(view.getPathname()).toBe("/send-feedback");
  await act(() => alertButton("Discard Edits").onPress?.());
  expect(view.getPathname()).toBe("/");
  expect(mockSubmit).not.toHaveBeenCalled();
});

it("keeps the line being typed at the end of a long message above the keyboard", async () => {
  const scrollToEnd = jest.spyOn(ScrollView.prototype, "scrollToEnd");
  await open();
  const field = screen.getByLabelText("Feedback");
  const lines = "a\nb\nc\nd\ne\nf\n";
  await fireEvent(field, "change", { nativeEvent: { text: lines, selection: { start: 12, end: 12 } } });
  expect(scrollToEnd).toHaveBeenLastCalledWith({ animated: true });
  // The new line grows the field after the change, so the sheet scrolls again once it has.
  await fireEvent(field, "contentSizeChange", { nativeEvent: { contentSize: { width: 330, height: 520 } } });
  expect(scrollToEnd).toHaveBeenCalledTimes(2);

  // A caret earlier in the message is on a line only the text view knows, so the sheet stays where it is.
  await fireEvent(field, "change", { nativeEvent: { text: `x${lines}`, selection: { start: 1, end: 1 } } });
  await fireEvent(field, "contentSizeChange", { nativeEvent: { contentSize: { width: 330, height: 520 } } });
  expect(scrollToEnd).toHaveBeenCalledTimes(2);
});

it("keeps the draft after a failed send and retries it from the toast", async () => {
  mockSubmit.mockRejectedValueOnce(new Error("Network request failed"));
  const view = await open();
  await sendFeedback("The globe is slow.");
  expect(mockErrorToast).toHaveBeenCalledWith("Couldn’t send feedback.", expect.any(Function));
  expect(screen.getByLabelText("Feedback")).toHaveDisplayValue("The globe is slow.");
  expect(view.getPathname()).toBe("/send-feedback");
  await retry();
  expect(mockSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ message: "The globe is slow." }));
  expect(view.getPathname()).toBe("/");
  expect(alert).not.toHaveBeenCalled();
});

it("still sends a retry after the sheet closes, without navigating", async () => {
  mockSubmit.mockRejectedValueOnce(new Error("Network request failed"));
  await open();
  await sendFeedback("The globe is slow.");
  const back = jest.spyOn(router, "back");
  await screen.unmount();
  await retry();
  expect(mockSubmit).toHaveBeenCalledTimes(2);
  expect(mockToast).toHaveBeenCalledWith("Feedback sent. Thank you.");
  expect(back).not.toHaveBeenCalled();
});

it("explains the daily limit without offering a retry", async () => {
  mockSubmit.mockRejectedValue(new ConvexError({ code: "rate_limited", name: "appFeedback", retryAfter: 1000 }));
  await open();
  await sendFeedback("The globe is slow.");
  expect(mockErrorToast).toHaveBeenCalledWith("Couldn’t send feedback. Try again tomorrow.");
});

it("does not attempt a send while offline", async () => {
  mockOffline = true;
  await open();
  await sendFeedback("The globe is slow.");
  expect(mockErrorToast).toHaveBeenCalledWith("Couldn’t send feedback while offline.", expect.any(Function));
  expect(mockSubmit).not.toHaveBeenCalled();
});
