import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ConvexError } from "convex/values";

import { SendFeedbackScreen } from "./send-feedback-screen";

const mockSubmit = jest.fn();
const mockBack = jest.fn();
const mockToast = jest.fn();
const mockErrorToast = jest.fn();
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
jest.mock("@/lib/ui/toast", () => ({
  showToast: (...args: unknown[]) => mockToast(...args),
  showErrorToast: (...args: unknown[]) => mockErrorToast(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSubmit.mockResolvedValue(null);
  mockOffline = false;
});

async function sendFeedback(text: string) {
  await fireEvent.changeText(screen.getByLabelText("Feedback"), text);
  await fireEvent.press(screen.getByRole("button", { name: "Send" }));
}
async function retry() {
  const [, onRetry] = mockErrorToast.mock.lastCall as [string, () => void];
  await act(async () => onRetry());
}

it("sends the trimmed message with app details, then closes", async () => {
  await render(<SendFeedbackScreen />);
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  await sendFeedback("  Let me sort the wall by date. ");
  expect(mockSubmit).toHaveBeenCalledWith({
    message: "Let me sort the wall by date.",
    appVersion: expect.any(String),
    osVersion: expect.stringMatching(/^iOS /),
  });
  expect(mockToast).toHaveBeenCalledWith("Feedback sent. Thank you.");
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it("closes without sending", async () => {
  await render(<SendFeedbackScreen />);
  await fireEvent.changeText(screen.getByLabelText("Feedback"), "Never mind.");
  await fireEvent.press(screen.getByRole("button", { name: "Close" }));
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockSubmit).not.toHaveBeenCalled();
});

it("keeps the draft after a failed send and retries it from the toast", async () => {
  mockSubmit.mockRejectedValueOnce(new Error("Network request failed"));
  await render(<SendFeedbackScreen />);
  await sendFeedback("The globe is slow.");
  expect(mockErrorToast).toHaveBeenCalledWith("Couldn’t send feedback.", expect.any(Function));
  expect(screen.getByLabelText("Feedback")).toHaveDisplayValue("The globe is slow.");
  expect(mockBack).not.toHaveBeenCalled();
  await retry();
  expect(mockSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ message: "The globe is slow." }));
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it("still sends a retry after the sheet closes, without navigating", async () => {
  mockSubmit.mockRejectedValueOnce(new Error("Network request failed"));
  await render(<SendFeedbackScreen />);
  await sendFeedback("The globe is slow.");
  await screen.unmount();
  await retry();
  expect(mockSubmit).toHaveBeenCalledTimes(2);
  expect(mockToast).toHaveBeenCalledWith("Feedback sent. Thank you.");
  expect(mockBack).not.toHaveBeenCalled();
});

it("explains the daily limit without offering a retry", async () => {
  mockSubmit.mockRejectedValue(new ConvexError({ code: "rate_limited", name: "appFeedback", retryAfter: 1000 }));
  await render(<SendFeedbackScreen />);
  await sendFeedback("The globe is slow.");
  expect(mockErrorToast).toHaveBeenCalledWith("Couldn’t send feedback. Try again tomorrow.");
});

it("does not attempt a send while offline", async () => {
  mockOffline = true;
  await render(<SendFeedbackScreen />);
  await sendFeedback("The globe is slow.");
  expect(mockErrorToast).toHaveBeenCalledWith("Couldn’t send feedback while offline.", expect.any(Function));
  expect(mockSubmit).not.toHaveBeenCalled();
});
