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
  mockSubmit.mockResolvedValue("report");
  mockOffline = false;
});

const send = () => fireEvent.press(screen.getByRole("button", { name: "Send report" }));

it("sends the chosen reason and trimmed details for a comment, then closes", async () => {
  await render(<ReportScreen kind="comment" id="comment-1" />);
  expect(screen.getByRole("header", { name: "Report comment" })).toBeOnTheScreen();
  expect(screen.queryByRole("radio", { name: "Pretending to be someone else" })).toBeNull();
  expect(screen.getByRole("button", { name: "Send report" })).toBeDisabled();
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

it("needs details before sending “Something else”", async () => {
  await render(<ReportScreen kind="profile" id="profile-1" />);
  expect(screen.getByRole("header", { name: "Report profile" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("radio", { name: "Something else" }));
  expect(screen.getByRole("button", { name: "Send report" })).toBeDisabled();
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
  expect(screen.queryByRole("button", { name: "Send report" })).toBeNull();
});
