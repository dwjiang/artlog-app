import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from "expo-network";
import { AppState, type AppStateStatus } from "react-native";

import { addBreadcrumb, reportError } from "./observability";
import { reportIfStalled, StallError } from "./stall-report";

jest.mock("./observability", () => ({ addBreadcrumb: jest.fn(), reportError: jest.fn() }));
jest.mock("expo-network", () => ({ addNetworkStateListener: jest.fn(), getNetworkStateAsync: jest.fn() }));

let onChange: ((state: AppStateStatus) => void) | undefined;
let onNetworkChange: ((state: NetworkState) => void) | undefined;
const remove = jest.fn();
const removeNetwork = jest.fn();
const online = { isConnected: true, isInternetReachable: true };
const offline = { isConnected: false, isInternetReachable: false };
const presetState = AppState.currentState;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  onNetworkChange = undefined;
  jest.mocked(getNetworkStateAsync).mockResolvedValue(online);
  jest.mocked(addNetworkStateListener).mockImplementation((callback) => {
    onNetworkChange = callback;
    return { remove: removeNetwork };
  });
  jest.spyOn(AppState, "addEventListener").mockImplementation((_, callback) => {
    onChange = callback;
    return { remove };
  });
  // The React Native Jest preset mocks `currentState` as a function.
  Object.assign(AppState, { currentState: "active" });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});
afterAll(() => Object.assign(AppState, { currentState: presetState }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

it("reports a task that has not settled after the limit, once, then notes when it finishes", async () => {
  const task = deferred<string>();
  const watched = reportIfStalled(task.promise, "test.request", 15_000, { data: () => ({ stage: "identify" }) });
  await jest.advanceTimersByTimeAsync(14_999);
  expect(reportError).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  expect(reportError).toHaveBeenCalledWith(expect.any(StallError), "test.request", {
    level: "warning",
    data: { stage: "identify", app_state: "active", limit_ms: 15_000 },
  });
  await jest.advanceTimersByTimeAsync(60_000);
  expect(reportError).toHaveBeenCalledTimes(1);
  task.resolve("result");
  await expect(watched).resolves.toBe("result");
  expect(addBreadcrumb).toHaveBeenCalledWith("test.request.settled", { elapsed_ms: 75_000 });
  expect(remove).toHaveBeenCalledTimes(1);
});

it("stays silent for a task that settles in time and keeps its rejection", async () => {
  const task = deferred<string>();
  const failure = new Error("server failed");
  const watched = reportIfStalled(task.promise, "test.request", 15_000);
  task.reject(failure);
  await expect(watched).rejects.toBe(failure);
  await jest.advanceTimersByTimeAsync(30_000);
  expect(reportError).not.toHaveBeenCalled();
  expect(addBreadcrumb).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledTimes(1);
});

it("stops watching once the app goes to the background", async () => {
  const task = deferred<string>();
  void reportIfStalled(task.promise, "test.request", 15_000);
  onChange?.("inactive");
  onChange?.("background");
  await jest.advanceTimersByTimeAsync(30_000);
  expect(reportError).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledTimes(1);
});

it("still reports when collecting diagnostics throws", async () => {
  void reportIfStalled(deferred<string>().promise, "test.request", 1_000, {
    data: () => {
      throw new Error("unavailable");
    },
  });
  await jest.advanceTimersByTimeAsync(1_000);
  expect(reportError).toHaveBeenCalledWith(expect.any(StallError), "test.request", {
    level: "warning",
    data: { app_state: "active", limit_ms: 1_000 },
  });
});

it("reports a network request that stalls while online and releases its listeners", async () => {
  const task = deferred<string>();
  const watched = reportIfStalled(task.promise, "test.network", 20_000, { requiresNetwork: true });
  expect(watched).toBe(task.promise);
  await jest.advanceTimersByTimeAsync(20_000);
  expect(reportError).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledTimes(1);
  expect(removeNetwork).toHaveBeenCalledTimes(1);
  task.resolve("result");
  await expect(watched).resolves.toBe("result");
});

it("does not report a request started offline, and preserves its rejection", async () => {
  jest.mocked(getNetworkStateAsync).mockResolvedValue(offline);
  const task = deferred<string>();
  const watched = reportIfStalled(task.promise, "test.network", 20_000, { requiresNetwork: true });
  await jest.advanceTimersByTimeAsync(20_000);
  expect(reportError).not.toHaveBeenCalled();
  expect(removeNetwork).toHaveBeenCalledTimes(1);
  const failure = new Error("Network request failed");
  task.reject(failure);
  await expect(watched).rejects.toBe(failure);
  expect(addBreadcrumb).not.toHaveBeenCalled();
});

it("stops a network watch after connectivity drops, even if it reconnects before the deadline", async () => {
  void reportIfStalled(deferred<string>().promise, "test.network", 20_000, { requiresNetwork: true });
  await jest.advanceTimersByTimeAsync(19_000);
  onNetworkChange?.(offline);
  onNetworkChange?.(online);
  await jest.advanceTimersByTimeAsync(20_000);
  expect(reportError).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledTimes(1);
  expect(removeNetwork).toHaveBeenCalledTimes(1);
});

it("does not revive an offline watch when its initial network snapshot arrives late", async () => {
  const initial = deferred<NetworkState>();
  jest.mocked(getNetworkStateAsync).mockReturnValue(initial.promise);
  void reportIfStalled(deferred<string>().promise, "test.network", 20_000, { requiresNetwork: true });
  onNetworkChange?.(offline);
  initial.resolve(online);
  await jest.advanceTimersByTimeAsync(20_000);
  expect(reportError).not.toHaveBeenCalled();
  expect(removeNetwork).toHaveBeenCalledTimes(1);
});

it("keeps a local watchdog active without consulting connectivity", async () => {
  jest.mocked(getNetworkStateAsync).mockResolvedValue(offline);
  void reportIfStalled(deferred<string>().promise, "camera.start_stalled", 8_000);
  await jest.advanceTimersByTimeAsync(8_000);
  expect(reportError).toHaveBeenCalledTimes(1);
  expect(getNetworkStateAsync).not.toHaveBeenCalled();
  expect(addNetworkStateListener).not.toHaveBeenCalled();
});

it("stays silent if connectivity cannot be determined without changing the task's result", async () => {
  jest.mocked(getNetworkStateAsync).mockRejectedValue(new Error("Network state unavailable"));
  const task = deferred<string>();
  const watched = reportIfStalled(task.promise, "test.network", 20_000, { requiresNetwork: true });
  await jest.advanceTimersByTimeAsync(20_000);
  expect(reportError).not.toHaveBeenCalled();
  expect(removeNetwork).toHaveBeenCalledTimes(1);
  task.resolve("result");
  await expect(watched).resolves.toBe("result");
});

it("releases the network listener when a request settles before the deadline", async () => {
  const task = deferred<string>();
  const watched = reportIfStalled(task.promise, "test.network", 20_000, { requiresNetwork: true });
  task.resolve("result");
  await expect(watched).resolves.toBe("result");
  expect(removeNetwork).toHaveBeenCalledTimes(1);
  onNetworkChange?.(offline);
  await jest.advanceTimersByTimeAsync(20_000);
  expect(removeNetwork).toHaveBeenCalledTimes(1);
  expect(reportError).not.toHaveBeenCalled();
});
