import { render } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";

import { ConvexConnectionWatch } from "./convex-connection";

const mockReportError = jest.fn();
let mockConnected = true;
let mockOnConnection: (() => void) | undefined;
let mockNetwork = { isConnected: true, isInternetReachable: true };

jest.mock("./observability", () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }));
jest.mock("expo-network", () => ({ useNetworkState: () => mockNetwork }));
jest.mock("convex/react", () => ({ useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }) }));
jest.mock("./convex-client", () => ({
  convex: {
    connectionState: () => ({
      isWebSocketConnected: mockConnected,
      hasEverConnected: true,
      connectionCount: 3,
      connectionRetries: 7,
      inflightActions: 1,
      inflightMutations: 0,
      timeOfOldestInflightRequest: null,
      hasInflightRequests: true,
    }),
    subscribeToConnectionState: (callback: () => void) => {
      mockOnConnection = callback;
      return () => {
        mockOnConnection = undefined;
      };
    },
  },
}));

let onAppState: ((state: AppStateStatus) => void) | undefined;
const presetState = AppState.currentState;

beforeEach(() => {
  jest.useFakeTimers();
  mockReportError.mockReset();
  mockConnected = true;
  mockNetwork = { isConnected: true, isInternetReachable: true };
  jest.spyOn(AppState, "addEventListener").mockImplementation((_, callback) => {
    onAppState = callback;
    return { remove: jest.fn() };
  });
  Object.assign(AppState, { currentState: "active" });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});
afterAll(() => Object.assign(AppState, { currentState: presetState }));

const disconnect = () => {
  mockConnected = false;
  mockOnConnection?.();
};

it("reports one stall per outage once the socket stays down for 30 s while the phone is online", async () => {
  await render(<ConvexConnectionWatch />);
  disconnect();
  await jest.advanceTimersByTimeAsync(29_999);
  expect(mockReportError).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), "convex.connection", {
    level: "warning",
    data: expect.objectContaining({
      ws_connected: false,
      connection_retries: 7,
      inflight_actions: 1,
      authenticated: true,
      stalled_ms: 30_000,
    }),
  });
  mockOnConnection?.();
  await jest.advanceTimersByTimeAsync(60_000);
  expect(mockReportError).toHaveBeenCalledTimes(1);
  mockConnected = true;
  mockOnConnection?.();
  disconnect();
  await jest.advanceTimersByTimeAsync(30_000);
  expect(mockReportError).toHaveBeenCalledTimes(2);
});

it("ignores a short reconnect, a backgrounded app and an offline phone", async () => {
  const screen = await render(<ConvexConnectionWatch />);
  disconnect();
  await jest.advanceTimersByTimeAsync(10_000);
  mockConnected = true;
  mockOnConnection?.();
  await jest.advanceTimersByTimeAsync(30_000);
  disconnect();
  Object.assign(AppState, { currentState: "background" });
  onAppState?.("background");
  await jest.advanceTimersByTimeAsync(60_000);
  Object.assign(AppState, { currentState: "active" });
  mockNetwork = { isConnected: false, isInternetReachable: false };
  await screen.rerender(<ConvexConnectionWatch />);
  await jest.advanceTimersByTimeAsync(60_000);
  expect(mockReportError).not.toHaveBeenCalled();
});
