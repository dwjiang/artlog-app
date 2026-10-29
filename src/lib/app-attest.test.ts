import * as AppIntegrity from "@expo/app-integrity";
import { AppState } from "react-native";

import { getAppAttest } from "./app-attest";
import { addBreadcrumb } from "./observability";

jest.mock("react-native", () => ({
  AppState: { currentState: "active", addEventListener: jest.fn() },
}));
jest.mock("./observability", () => ({ addBreadcrumb: jest.fn() }));

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(AppState.addEventListener).mockReturnValue({ remove: jest.fn() });
});

afterEach(() => jest.restoreAllMocks());

jest.mock("@expo/app-integrity", () => ({
  isSupported: false,
  generateKeyAsync: jest.fn(),
  attestKeyAsync: jest.fn(),
  generateAssertionAsync: jest.fn(),
}));

it("returns null on unsupported devices", () => {
  expect(getAppAttest()).toBeNull();
});

it("records lifecycle and memory-pressure evidence around a failed native key generation without changing the error", async () => {
  jest.replaceProperty(AppIntegrity, "isSupported", true);
  const error = { code: "ERR_APP_INTEGRITY_SYSTEM_FAILURE", message: "private native description" };
  const listeners = new Map<string, (state?: string) => void>();
  const removeLifecycle = jest.fn();
  const removeMemory = jest.fn();
  jest.mocked(AppState.addEventListener).mockImplementation((type, listener) => {
    listeners.set(type, listener as (state?: string) => void);
    return { remove: type === "change" ? removeLifecycle : removeMemory };
  });
  jest.spyOn(Date, "now").mockReturnValueOnce(100).mockReturnValueOnce(350);
  jest.mocked(AppIntegrity.generateKeyAsync).mockImplementationOnce(async () => {
    listeners.get("change")?.("background");
    listeners.get("memoryWarning")?.();
    listeners.get("change")?.("active");
    throw error;
  });
  await expect(getAppAttest()!.generateKey()).rejects.toBe(error);
  expect(addBreadcrumb).toHaveBeenLastCalledWith("auth.app_attest.failure", {
    operation: "generate_key",
    elapsed_ms: 250,
    state_before: "active",
    state_after: "active",
    state_changes: 2,
    memory_warning: true,
    lifecycle_observed: true,
    memory_observed: true,
  });
  expect(removeLifecycle).toHaveBeenCalledTimes(1);
  expect(removeMemory).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(jest.mocked(addBreadcrumb).mock.calls)).not.toContain("private native description");
});

it.each(["attestKey", "generateAssertion"] as const)(
  "records %s success without key, challenge, or proof values",
  async (method) => {
    jest.replaceProperty(AppIntegrity, "isSupported", true);
    jest.mocked(AppIntegrity.attestKeyAsync).mockResolvedValue("private-proof");
    jest.mocked(AppIntegrity.generateAssertionAsync).mockResolvedValue("private-proof");
    await expect(getAppAttest()![method]("private-key", "private-challenge")).resolves.toBe("private-proof");
    expect(addBreadcrumb).toHaveBeenLastCalledWith(
      "auth.app_attest.success",
      expect.objectContaining({
        operation: method === "attestKey" ? "attest_key" : "generate_assertion",
        state_changes: 0,
        memory_warning: false,
      }),
    );
    expect(JSON.stringify(jest.mocked(addBreadcrumb).mock.calls)).not.toMatch(/private-(key|challenge|proof)/);
  },
);

it("does not interrupt native calls when diagnostics cannot observe or record", async () => {
  jest.replaceProperty(AppIntegrity, "isSupported", true);
  jest.mocked(AppState.addEventListener).mockImplementation(() => {
    throw new Error("observer unavailable");
  });
  jest.mocked(addBreadcrumb).mockImplementation(() => {
    throw new Error("telemetry unavailable");
  });
  jest.mocked(AppIntegrity.generateKeyAsync).mockResolvedValue("key");
  await expect(getAppAttest()!.generateKey()).resolves.toBe("key");
  const error = new Error("native failure");
  jest.mocked(AppIntegrity.generateKeyAsync).mockRejectedValueOnce(error);
  await expect(getAppAttest()!.generateKey()).rejects.toBe(error);
});

it("allowlists unknown lifecycle values and bounds elapsed duration", async () => {
  jest.replaceProperty(AppIntegrity, "isSupported", true);
  jest.replaceProperty(AppState, "currentState", "private-state" as never);
  jest.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValueOnce(Number.POSITIVE_INFINITY);
  jest.mocked(AppIntegrity.generateKeyAsync).mockResolvedValue("key");
  await getAppAttest()!.generateKey();
  expect(addBreadcrumb).toHaveBeenLastCalledWith(
    "auth.app_attest.success",
    expect.objectContaining({
      state_before: "unknown",
      state_after: "unknown",
      elapsed_ms: null,
    }),
  );
});

it.each([
  [-100, 0],
  [500_000, 300_000],
])("bounds a measured duration of %s milliseconds to %s", async (elapsed, expected) => {
  jest.replaceProperty(AppIntegrity, "isSupported", true);
  jest
    .spyOn(Date, "now")
    .mockReturnValueOnce(1000)
    .mockReturnValueOnce(1000 + elapsed);
  jest.mocked(AppIntegrity.generateKeyAsync).mockResolvedValue("key");
  await getAppAttest()!.generateKey();
  expect(addBreadcrumb).toHaveBeenLastCalledWith(
    "auth.app_attest.success",
    expect.objectContaining({ elapsed_ms: expected }),
  );
});

it("bounds lifecycle counts and keeps the native failure when subscription cleanup throws", async () => {
  jest.replaceProperty(AppIntegrity, "isSupported", true);
  const removeMemory = jest.fn();
  let onChange: (() => void) | undefined;
  jest.mocked(AppState.addEventListener).mockImplementation((type, listener) => {
    if (type === "change") {
      onChange = listener as () => void;
      return {
        remove: () => {
          throw new Error("teardown unavailable");
        },
      };
    }
    return { remove: removeMemory };
  });
  const error = new Error("native failure");
  jest.mocked(AppIntegrity.generateKeyAsync).mockImplementationOnce(async () => {
    for (let index = 0; index < 120; index++) onChange?.();
    throw error;
  });
  await expect(getAppAttest()!.generateKey()).rejects.toBe(error);
  expect(addBreadcrumb).toHaveBeenLastCalledWith(
    "auth.app_attest.failure",
    expect.objectContaining({ state_changes: 100 }),
  );
  expect(removeMemory).toHaveBeenCalledTimes(1);
});

it("passes the original challenge strings to the native implementation", async () => {
  jest.replaceProperty(AppIntegrity, "isSupported", true);
  jest.mocked(AppIntegrity.generateKeyAsync).mockResolvedValue("key");
  jest.mocked(AppIntegrity.attestKeyAsync).mockResolvedValue("attestation");
  jest.mocked(AppIntegrity.generateAssertionAsync).mockResolvedValue("assertion");
  try {
    const attest = getAppAttest()!;
    expect(attest.isSupported()).toBe(true);
    expect(await attest.generateKey()).toBe("key");
    expect(await attest.attestKey("key", "nonce")).toBe("attestation");
    expect(await attest.generateAssertion("key", "nonce.{}")).toBe("assertion");
    expect(AppIntegrity.attestKeyAsync).toHaveBeenCalledWith("key", "nonce");
    expect(AppIntegrity.generateAssertionAsync).toHaveBeenCalledWith("key", "nonce.{}");
  } finally {
    jest.restoreAllMocks();
  }
});
