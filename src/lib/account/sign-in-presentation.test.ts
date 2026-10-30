import { AppState, type AppStateStatus } from "react-native";

import { presentWhenActive } from "./sign-in-presentation";

let onChange: ((state: AppStateStatus) => void) | undefined;
const remove = jest.fn();
const presetState = AppState.currentState;

// The React Native Jest preset mocks `currentState` as a function, which replaceProperty refuses.
function setAppState(state: AppStateStatus) {
  Object.assign(AppState, { currentState: state });
}

afterAll(() => Object.assign(AppState, { currentState: presetState }));

beforeEach(() => {
  jest.useFakeTimers();
  onChange = undefined;
  remove.mockClear();
  jest.spyOn(AppState, "addEventListener").mockImplementation((_, callback) => {
    onChange = callback;
    return { remove };
  });
  setAppState("active");
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const missingWindow = (cause: unknown) => cause === "no window";

it("presents immediately while the app is active", async () => {
  const data = {};
  await expect(presentWhenActive(async () => "credential", missingWindow, data)).resolves.toBe("credential");
  expect(AppState.addEventListener).not.toHaveBeenCalled();
  expect(data).toEqual({ active_wait: "none" });
});

it("waits for the person to return before presenting", async () => {
  setAppState("background");
  const present = jest.fn(async () => "credential");
  const data = {};
  const result = presentWhenActive(present, missingWindow, data);
  await Promise.resolve();
  onChange?.("inactive");
  expect(present).not.toHaveBeenCalled();
  onChange?.("active");
  await expect(result).resolves.toBe("credential");
  expect(remove).toHaveBeenCalledTimes(1);
  expect(data).toEqual({ active_wait: "returned" });
});

it("stops waiting after a minute and presents anyway", async () => {
  setAppState("background");
  const present = jest.fn(async () => "credential");
  const data = {};
  const result = presentWhenActive(present, missingWindow, data);
  await jest.advanceTimersByTimeAsync(59_999);
  expect(present).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  await expect(result).resolves.toBe("credential");
  expect(remove).toHaveBeenCalledTimes(1);
  expect(data).toEqual({ active_wait: "timed_out" });
});

it("retries once after a missing-window failure, waiting for the app again", async () => {
  const present = jest
    .fn<Promise<string>, []>()
    .mockImplementationOnce(async () => {
      setAppState("background");
      throw "no window";
    })
    .mockResolvedValueOnce("credential");
  const data = {};
  const result = presentWhenActive(present, missingWindow, data);
  await jest.advanceTimersByTimeAsync(0);
  expect(present).toHaveBeenCalledTimes(1);
  onChange?.("active");
  await expect(result).resolves.toBe("credential");
  expect(present).toHaveBeenCalledTimes(2);
  expect(data).toEqual({ active_wait: "none", presentation_retried: true, retry_active_wait: "returned" });
});

it("rethrows the second missing-window failure without a third attempt", async () => {
  const present = jest.fn(async () => {
    throw "no window";
  });
  await expect(presentWhenActive(present, missingWindow, {})).rejects.toBe("no window");
  expect(present).toHaveBeenCalledTimes(2);
});

it("does not retry other failures", async () => {
  const failure = new Error("cancelled");
  const present = jest.fn(async () => {
    throw failure;
  });
  const data = {};
  await expect(presentWhenActive(present, missingWindow, data)).rejects.toBe(failure);
  expect(present).toHaveBeenCalledTimes(1);
  expect(data).toEqual({ active_wait: "none" });
});
