import { requireOptionalNativeModule } from "expo";

import { signInPresentationSnapshot } from "./index";

jest.mock("expo", () => ({ requireOptionalNativeModule: jest.fn() }));

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(() => {
  jest.useRealTimers();
});

it("only exports recognized booleans and app states", async () => {
  jest.mocked(requireOptionalNativeModule).mockReturnValue({
    snapshot: async () => ({
      applicationState: "active",
      guidedAccess: true,
      hasPresenter: false,
      hasApplePresentationWindow: false,
      presenterHasWindow: "private",
      hierarchy: "private",
      email: "person@example.com",
    }),
  } as never);
  await expect(signInPresentationSnapshot()).resolves.toEqual({
    snapshot: "available",
    applicationState: "active",
    guidedAccess: true,
    hasPresenter: false,
    hasApplePresentationWindow: false,
  });
  expect(jest.getTimerCount()).toBe(0);
});

it("fails open when the native module is missing or throws", async () => {
  jest.mocked(requireOptionalNativeModule).mockReturnValue(null);
  await expect(signInPresentationSnapshot()).resolves.toEqual({ snapshot: "unavailable" });
  jest.mocked(requireOptionalNativeModule).mockReturnValue({
    snapshot: async () => {
      throw new Error("private");
    },
  } as never);
  await expect(signInPresentationSnapshot()).resolves.toEqual({ snapshot: "failed" });
  expect(jest.getTimerCount()).toBe(0);
});

it("bounds a stalled native snapshot and clears the timeout", async () => {
  jest.mocked(requireOptionalNativeModule).mockReturnValue({ snapshot: () => new Promise(() => {}) } as never);
  const result = signInPresentationSnapshot();
  await jest.advanceTimersByTimeAsync(150);
  await expect(result).resolves.toEqual({ snapshot: "timeout" });
  expect(jest.getTimerCount()).toBe(0);
});
