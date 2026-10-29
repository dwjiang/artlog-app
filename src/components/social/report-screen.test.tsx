import { act, fireEvent, screen } from "@testing-library/react-native";
import { ConvexError } from "convex/values";
import { router } from "expo-router";
import { Stack } from "expo-router/stack";
import { renderRouter } from "expo-router/testing-library";
import type { ComponentProps } from "react";
import { Alert, ScrollView, Text, type AlertButton } from "react-native";

import { ReportScreen } from "./report-screen";

const mockSubmit = jest.fn();
const mockToast = jest.fn();
const mockErrorToast = jest.fn();
const mockReportError = jest.fn();
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
jest.mock("@/lib/observability", () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }));
jest.mock("@/lib/ui/toast", () => ({
  showToast: (...args: unknown[]) => mockToast(...args),
  showErrorToast: (...args: unknown[]) => mockErrorToast(...args),
}));

let alert: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockSubmit.mockResolvedValue({ reportId: "report" });
  mockOffline = false;
  alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

let view: Awaited<ReturnType<typeof renderRouter>>;
const open = async (props: ComponentProps<typeof ReportScreen>) => {
  view = await renderRouter(
    { _layout: () => <Stack />, index: () => <Text>Post</Text>, report: () => <ReportScreen {...props} /> },
    { initialUrl: "/" },
  );
  await act(() => router.push("/report"));
};
const closed = () => view.getPathname() === "/";
const send = () => fireEvent.press(screen.getByRole("button", { name: "Report" }));
const alertButton = (text: string) =>
  (alert.mock.lastCall as [string, undefined, AlertButton[]])[2].find((button) => button.text === text)!;

it("sends the chosen reason and trimmed details for a comment, then closes", async () => {
  await open({ kind: "comment", id: "comment-1" });
  expect(screen.getByRole("header", { name: "Report Comment" })).toBeOnTheScreen();
  expect(screen.queryByRole("radio", { name: "Pretending to be someone else" })).toBeNull();
  expect(screen.getByRole("button", { name: "Report" })).toBeDisabled();
  await fireEvent.press(screen.getByRole("radio", { name: "Harassment or hate" }));
  expect(screen.getByRole("radio", { name: "Harassment or hate" })).toBeChecked();
  await fireEvent.changeText(screen.getByLabelText("Details (optional)"), "  Aimed at me.  ");
  await send();
  expect(mockSubmit).toHaveBeenCalledWith({
    target: { kind: "comment", commentId: "comment-1" },
    reason: "harassment",
    details: "Aimed at me.",
  });
  expect(mockToast).toHaveBeenCalledWith("Report sent. Thank you.");
  expect(closed()).toBe(true);
});

it.each([
  ["profile", "Report Profile"],
  ["wallItem", "Report Artwork"],
  ["sharedVisit", "Report Visit"],
  ["comment", "Report Comment"],
])("lets people report a %s as offensive", async (kind, title) => {
  await open({ kind, id: "item-1" });
  expect(screen.getByRole("header", { name: title })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("radio", { name: "Offensive or inappropriate" }));
  await send();
  expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ reason: "offensive" }));
});

it("needs details before sending “Something else”", async () => {
  await open({ kind: "profile", id: "profile-1" });
  expect(screen.getByRole("header", { name: "Report Profile" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("radio", { name: "Something else" }));
  expect(screen.getByRole("button", { name: "Report" })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText("Details"), "Copies my username.");
  await send();
  expect(mockSubmit).toHaveBeenCalledWith({
    target: { kind: "profile", profileId: "profile-1" },
    reason: "other",
    details: "Copies my username.",
  });
});

it("offers a retry for unexpected failures only", async () => {
  await open({ kind: "sharedVisit", id: "post-1" });
  await fireEvent.press(screen.getByRole("radio", { name: "Spam or scam" }));
  mockSubmit.mockRejectedValueOnce(new ConvexError({ code: "rate_limited" }));
  await send();
  expect(mockErrorToast).toHaveBeenLastCalledWith("Couldn’t send the report. Try again tomorrow.");
  mockSubmit.mockRejectedValueOnce(new ConvexError({ code: "not_found" }));
  await send();
  expect(mockErrorToast).toHaveBeenLastCalledWith("Couldn’t send the report. This visit is no longer available.");
  expect(mockReportError).not.toHaveBeenCalled();

  const failure = new Error("server down");
  mockSubmit.mockRejectedValueOnce(failure);
  await send();
  expect(mockReportError).toHaveBeenCalledWith(failure, "report.submit");
  expect(closed()).toBe(false);
  const [message, onRetry] = mockErrorToast.mock.lastCall as [string, () => void];
  expect(message).toBe("Couldn’t send the report.");
  await act(async () => onRetry());
  expect(mockSubmit).toHaveBeenCalledTimes(4);
  expect(closed()).toBe(true);
  expect(alert).not.toHaveBeenCalled();
});

it("does not send while offline", async () => {
  mockOffline = true;
  await open({ kind: "wallItem", id: "item-1" });
  await fireEvent.press(screen.getByRole("radio", { name: "Spam or scam" }));
  await send();
  expect(mockSubmit).not.toHaveBeenCalled();
  expect(mockErrorToast).toHaveBeenCalledWith("Couldn’t send the report while offline.", expect.any(Function));
});

it("explains a link without a reportable item", async () => {
  await open({ kind: "venue", id: "x" });
  expect(screen.getByText("This can’t be reported.")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Report" })).toBeNull();
  // Nothing to send, so the sheet closes with an X rather than Cancel.
  expect(screen.getByRole("button", { name: "Close" })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
});

it("offers description reasons and confirms the report was saved", async () => {
  await open({ kind: "docent", id: "artwork-1" });
  expect(screen.getByRole("header", { name: "Report Description" })).toBeOnTheScreen();
  expect(screen.getAllByRole("radio").map((radio) => radio.props.accessibilityLabel)).toEqual([
    "Wrong or made-up facts",
    "Describes a different artwork",
    "Offensive or inappropriate",
    "Copyright infringement",
    "Something else",
  ]);
  await fireEvent.press(screen.getByRole("radio", { name: "Wrong or made-up facts" }));
  await send();
  expect(mockSubmit).toHaveBeenCalledWith({ target: { kind: "docent", artworkId: "artwork-1" }, reason: "wrongFacts" });
  expect(mockToast).toHaveBeenCalledWith("Report sent. Thank you.");
  expect(closed()).toBe(true);
});

it.each([
  ["audio", "Report Audio", "Glitches or cuts off", "glitches"],
  ["transcript", "Report Transcript", "Offensive or inappropriate", "offensive"],
])("saves a %s report and closes with a simple confirmation", async (kind, title, label, reason) => {
  await open({ kind, id: "artwork-1", renderId: kind === "audio" ? "heard-render" : undefined });
  expect(screen.getByRole("header", { name: title })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("radio", { name: label }));
  await send();
  expect(mockSubmit).toHaveBeenCalledWith({
    target: { kind, artworkId: "artwork-1", ...(kind === "audio" ? { renderId: "heard-render" } : {}) },
    reason,
  });
  expect(mockToast).toHaveBeenCalledWith("Report sent. Thank you.");
  expect(closed()).toBe(true);
});

it("closes without asking before a reason or details are given", async () => {
  await open({ kind: "comment", id: "comment-1" });
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(closed()).toBe(true);
  expect(alert).not.toHaveBeenCalled();
});

it.each([
  ["a chosen reason", () => fireEvent.press(screen.getByRole("radio", { name: "Spam or scam" }))],
  ["typed details", () => fireEvent.changeText(screen.getByLabelText("Details (optional)"), "Posted twice.")],
])("asks before Cancel throws away %s", async (_input, edit) => {
  await open({ kind: "comment", id: "comment-1" });
  await edit();
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(alert).toHaveBeenCalledWith("Discard your edits?", undefined, expect.any(Array));
  await act(() => alertButton("Keep Editing").onPress?.());
  expect(closed()).toBe(false);
  await act(() => router.back());
  await act(() => alertButton("Discard Edits").onPress?.());
  expect(closed()).toBe(true);
  expect(mockSubmit).not.toHaveBeenCalled();
});

it("keeps the line being typed at the end of the details above the keyboard", async () => {
  const scrollToEnd = jest.spyOn(ScrollView.prototype, "scrollToEnd");
  await open({ kind: "comment", id: "comment-1" });
  const field = screen.getByLabelText("Details (optional)");
  await fireEvent(field, "change", { nativeEvent: { text: "Posted\n", selection: { start: 7, end: 7 } } });
  await fireEvent(field, "contentSizeChange", { nativeEvent: { contentSize: { width: 330, height: 140 } } });
  expect(scrollToEnd.mock.calls).toEqual([[{ animated: true }], [{ animated: true }]]);
});

it("stops the reasons growing where their longest word still fits beside the checkmark", async () => {
  await open({ kind: "audio", id: "artwork-1", renderId: "heard-render" });
  for (const reason of ["Mispronounced words", "Glitches or cuts off", "Doesn’t match the transcript"]) {
    expect(screen.getByText(reason).props.maxFontSizeMultiplier).toBe(2.5);
  }
});
