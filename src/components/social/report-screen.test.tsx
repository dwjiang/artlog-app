import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ConvexError } from "convex/values";

import { ReportScreen } from "./report-screen";

const mockSubmit = jest.fn();
const mockBack = jest.fn();
const mockToast = jest.fn();
const mockErrorToast = jest.fn();
const mockReportError = jest.fn();
let mockOffline = false;
jest.mock("convex/react", () => ({
  ...jest.requireActual("convex/react"),
  useMutation: () => mockSubmit,
}));
jest.mock("expo-router", () => ({ router: { back: () => mockBack() }, Stack: { Screen: () => null } }));
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

beforeEach(() => {
  jest.clearAllMocks();
  mockSubmit.mockResolvedValue({ reportId: "report" });
  mockOffline = false;
});

const send = () => fireEvent.press(screen.getByRole("button", { name: "Report" }));

it("sends the chosen reason and trimmed details for a comment, then closes", async () => {
  await render(<ReportScreen kind="comment" id="comment-1" />);
  expect(screen.getByRole("header", { name: "Report comment" })).toBeOnTheScreen();
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
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it.each([
  ["profile", "Report profile"],
  ["wallItem", "Report artwork"],
  ["sharedVisit", "Report visit"],
  ["comment", "Report comment"],
])("lets people report a %s as offensive", async (kind, title) => {
  await render(<ReportScreen kind={kind} id="item-1" />);
  expect(screen.getByRole("header", { name: title })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("radio", { name: "Offensive or inappropriate" }));
  await send();
  expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ reason: "offensive" }));
});

it("needs details before sending “Something else”", async () => {
  await render(<ReportScreen kind="profile" id="profile-1" />);
  expect(screen.getByRole("header", { name: "Report profile" })).toBeOnTheScreen();
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
  await render(<ReportScreen kind="sharedVisit" id="post-1" />);
  await fireEvent.press(screen.getByRole("radio", { name: "Spam or scam" }));
  const failure = new Error("server down");
  mockSubmit.mockRejectedValueOnce(failure);
  await send();
  expect(mockReportError).toHaveBeenCalledWith(failure, "report.submit");
  expect(mockBack).not.toHaveBeenCalled();
  const [message, onRetry] = mockErrorToast.mock.lastCall as [string, () => void];
  expect(message).toBe("Couldn’t send the report.");
  await act(async () => onRetry());
  expect(mockSubmit).toHaveBeenCalledTimes(2);
  expect(mockBack).toHaveBeenCalledTimes(1);

  mockSubmit.mockRejectedValueOnce(new ConvexError({ code: "rate_limited" }));
  await send();
  expect(mockErrorToast).toHaveBeenLastCalledWith("Couldn’t send the report. Try again tomorrow.");
  mockSubmit.mockRejectedValueOnce(new ConvexError({ code: "not_found" }));
  await send();
  expect(mockErrorToast).toHaveBeenLastCalledWith("Couldn’t send the report. This visit is no longer available.");
  expect(mockReportError).toHaveBeenCalledTimes(1);
});

it("does not send while offline", async () => {
  mockOffline = true;
  await render(<ReportScreen kind="wallItem" id="item-1" />);
  await fireEvent.press(screen.getByRole("radio", { name: "Spam or scam" }));
  await send();
  expect(mockSubmit).not.toHaveBeenCalled();
  expect(mockErrorToast).toHaveBeenCalledWith("Couldn’t send the report while offline.", expect.any(Function));
});

it("explains a link without a reportable item", async () => {
  await render(<ReportScreen kind="venue" id="x" />);
  expect(screen.getByText("This can’t be reported.")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Report" })).toBeNull();
});

it("offers description reasons and confirms the report was saved", async () => {
  await render(<ReportScreen kind="docent" id="artwork-1" />);
  expect(screen.getByRole("header", { name: "Report description" })).toBeOnTheScreen();
  expect(screen.getAllByRole("radio").map((radio) => radio.props.accessibilityLabel)).toEqual([
    "Wrong or made-up facts",
    "Describes a different artwork",
    "Offensive or inappropriate",
    "Something else",
  ]);
  await fireEvent.press(screen.getByRole("radio", { name: "Wrong or made-up facts" }));
  await send();
  expect(mockSubmit).toHaveBeenCalledWith({ target: { kind: "docent", artworkId: "artwork-1" }, reason: "wrongFacts" });
  expect(mockToast).toHaveBeenCalledWith("Report sent. Thank you.");
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it.each([
  ["audio", "Glitches or cuts off", "glitches"],
  ["transcript", "Offensive or inappropriate", "offensive"],
])("saves a %s report and closes with a simple confirmation", async (kind, label, reason) => {
  await render(<ReportScreen kind={kind} id="artwork-1" renderId={kind === "audio" ? "heard-render" : undefined} />);
  expect(screen.getByRole("header", { name: `Report ${kind}` })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("radio", { name: label }));
  await send();
  expect(mockSubmit).toHaveBeenCalledWith({
    target: { kind, artworkId: "artwork-1", ...(kind === "audio" ? { renderId: "heard-render" } : {}) },
    reason,
  });
  expect(mockToast).toHaveBeenCalledWith("Report sent. Thank you.");
  expect(mockBack).toHaveBeenCalledTimes(1);
});
