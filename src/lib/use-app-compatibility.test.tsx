import { act, renderHook } from "@testing-library/react-native";
import Constants from "expo-constants";
import { AppState, type AppStateStatus } from "react-native";

import { cacheMinimum, fetchMinimum, readCachedMinimum } from "./app-compatibility";
import { reportError } from "./observability";
import { useAppCompatibility } from "./use-app-compatibility";

jest.mock("expo-constants", () => ({ __esModule: true, default: { platform: { ios: { buildNumber: "10" } } } }));
jest.mock("./app-compatibility", () => ({
  readCachedMinimum: jest.fn(),
  fetchMinimum: jest.fn(),
  cacheMinimum: jest.fn(),
}));
jest.mock("./observability", () => ({ reportError: jest.fn() }));
const mockNetworkRemove = jest.fn();
let mockNetworkChanged: (state: { isConnected: boolean }) => void;
jest.mock("expo-network", () => ({
  addNetworkStateListener: (callback: typeof mockNetworkChanged) => {
    mockNetworkChanged = callback;
    return { remove: mockNetworkRemove };
  },
}));

const fetchMinimumMock = jest.mocked(fetchMinimum);
const readCacheMock = jest.mocked(readCachedMinimum);
let changeAppState: (state: AppStateStatus) => void;
const appStateRemove = jest.fn();

function pendingRequest() {
  return jest.fn(
    (signal: AbortSignal) =>
      new Promise<string | null>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );
}

async function backgroundThenReturn() {
  await act(() => {
    AppState.currentState = "background";
    changeAppState("background");
  });
  await act(() => {
    AppState.currentState = "active";
    changeAppState("active");
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  AppState.currentState = "active";
  Constants.platform!.ios!.buildNumber = "10";
  readCacheMock.mockResolvedValue(undefined);
  fetchMinimumMock.mockReset().mockResolvedValue(null);
  jest.mocked(cacheMinimum).mockResolvedValue();
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, callback) => {
    changeAppState = callback;
    return { remove: appStateRemove };
  });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it("holds a launch with no saved answer until checked, then blocks an older build and caches the requirement", async () => {
  let finish!: (minimum: string) => void;
  fetchMinimumMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { result } = await renderHook(useAppCompatibility);
  expect(result.current).toEqual({ loading: true, updateRequired: false });
  await act(() => finish("11"));
  expect(result.current).toEqual({ loading: false, updateRequired: true });
  expect(cacheMinimum).toHaveBeenCalledWith("11");
});

it("allows supported builds", async () => {
  fetchMinimumMock.mockResolvedValue("10");
  const { result } = await renderHook(useAppCompatibility);
  expect(result.current).toEqual({ loading: false, updateRequired: false });
});

it("opens at once with a saved answer, then blocks when the check finds a raised minimum", async () => {
  readCacheMock.mockResolvedValue(null);
  let finish!: (minimum: string) => void;
  fetchMinimumMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { result } = await renderHook(useAppCompatibility);
  expect(result.current).toEqual({ loading: false, updateRequired: false });
  await act(() => finish("11"));
  expect(result.current).toEqual({ loading: false, updateRequired: true });
  expect(cacheMinimum).toHaveBeenCalledWith("11");
});

it.each([null, "11"])("keeps saved minimum %s when the startup check times out", async (cached) => {
  readCacheMock.mockResolvedValue(cached);
  fetchMinimumMock.mockImplementation(pendingRequest());
  const { result } = await renderHook(useAppCompatibility);
  expect(result.current).toEqual({ loading: false, updateRequired: cached !== null });
  await act(() => jest.advanceTimersByTimeAsync(4_000));
  expect(result.current).toEqual({ loading: false, updateRequired: cached !== null });
  expect(reportError).not.toHaveBeenCalled();
  expect(cacheMinimum).not.toHaveBeenCalled();
});

it("opens a first launch without a connection once the check times out", async () => {
  fetchMinimumMock.mockImplementation(pendingRequest());
  const { result } = await renderHook(useAppCompatibility);
  expect(result.current.loading).toBe(true);
  await act(() => jest.advanceTimersByTimeAsync(4_000));
  expect(result.current).toEqual({ loading: false, updateRequired: false });
});

it("lets an upgraded build pass a cached requirement while offline", async () => {
  Constants.platform!.ios!.buildNumber = "11";
  readCacheMock.mockResolvedValue("11");
  fetchMinimumMock.mockImplementation(pendingRequest());
  const { result } = await renderHook(useAppCompatibility);
  await act(() => jest.advanceTimersByTimeAsync(4_000));
  expect(result.current.updateRequired).toBe(false);
});

it("rechecks on foreground and clears a rolled-back requirement", async () => {
  fetchMinimumMock.mockResolvedValueOnce("11").mockResolvedValue(null);
  const { result } = await renderHook(useAppCompatibility);
  expect(result.current.updateRequired).toBe(true);
  await backgroundThenReturn();
  expect(result.current).toEqual({ loading: false, updateRequired: false });
  expect(cacheMinimum).toHaveBeenLastCalledWith(null);
});

it("checks after reconnecting and periodically while active", async () => {
  const { result } = await renderHook(useAppCompatibility);
  fetchMinimumMock.mockResolvedValue("11");
  await act(() => mockNetworkChanged({ isConnected: true }));
  expect(result.current.updateRequired).toBe(true);
  fetchMinimumMock.mockResolvedValue(null);
  await act(() => jest.advanceTimersByTimeAsync(60_000));
  expect(result.current.updateRequired).toBe(false);
});

it("discards a stale response after backgrounding and a newer check", async () => {
  let finishOld!: (minimum: null) => void;
  fetchMinimumMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      }),
  );
  fetchMinimumMock.mockResolvedValue("11");
  const { result } = await renderHook(useAppCompatibility);
  await backgroundThenReturn();
  expect(result.current.updateRequired).toBe(true);
  await act(() => finishOld(null));
  expect(result.current.updateRequired).toBe(true);
  expect(cacheMinimum).not.toHaveBeenCalledWith(null);
});

it("keeps the cached requirement on server failure and reports it", async () => {
  const error = new Error("Invalid server configuration");
  readCacheMock.mockResolvedValue("11");
  fetchMinimumMock.mockRejectedValue(error);
  const { result } = await renderHook(useAppCompatibility);
  expect(result.current).toEqual({ loading: false, updateRequired: true });
  expect(reportError).toHaveBeenCalledWith(error, "app-update.check");
});

it("cancels its request and removes listeners on unmount", async () => {
  fetchMinimumMock.mockImplementation(pendingRequest());
  const { unmount } = await renderHook(useAppCompatibility);
  const signal = fetchMinimumMock.mock.calls[0][0];
  await unmount();
  expect(signal.aborted).toBe(true);
  expect(mockNetworkRemove).toHaveBeenCalled();
  expect(appStateRemove).toHaveBeenCalled();
});
