import { act, renderHook } from "@testing-library/react-native";
import { ConvexError } from "convex/values";
import * as React from "react";

const mockAuth = { isAuthenticated: false, isLoading: true };
const mockSignIn = jest.fn();
const mockSignOut = jest.fn();
let mockRevoked: boolean | undefined;
const mockRegister = jest.fn();
const mockChallenge = jest.fn();
const mockAttest = jest.fn();
const mockGetItem = jest.fn();
const mockSetItem = jest.fn();
const mockDeleteItem = jest.fn();
const mockRandomBytes = jest.fn();
const mockReportError = jest.fn();
const mockStorage = new Map<string, string>();
const mockAppAttest = {
  isSupported: jest.fn(),
  generateKey: jest.fn(),
  attestKey: jest.fn(),
};

jest.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: mockSignIn, signOut: mockSignOut }),
}));
jest.mock("convex/react", () => ({
  useConvexAuth: () => mockAuth,
  useMutation: (ref: string) => (ref === "register" ? mockRegister : mockChallenge),
  useAction: () => mockAttest,
  useQuery: (_ref: string, args: unknown) => (args === "skip" ? undefined : mockRevoked),
}));
jest.mock("../../convex/_generated/api", () => ({
  api: {
    devices: {
      registerDevice: "register",
      createChallenge: "challenge",
      attestDevice: "attest",
      sessionRevoked: "sessionRevoked",
    },
  },
}));
jest.mock("expo-device", () => ({ isDevice: false }));
jest.mock("expo-crypto", () => ({
  getRandomBytesAsync: (...args: unknown[]) => mockRandomBytes(...args),
}));
jest.mock("@/lib/installation-storage", () => ({
  installationStorage: {
    getItem: (...args: unknown[]) => mockGetItem(...args),
    setItem: (...args: unknown[]) => mockSetItem(...args),
    removeItem: (...args: unknown[]) => mockDeleteItem(...args),
  },
}));
jest.mock("@/lib/app-attest", () => ({
  APP_ATTEST_KEY_ID: "appAttestKeyId",
  getAppAttest: () => (mockAppAttest.isSupported() ? mockAppAttest : null),
}));
jest.mock("@/lib/observability", () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
  addBreadcrumb: jest.fn(),
}));

let identity: typeof import("./device-identity");
let useDeviceIdentity: typeof identity.useDeviceIdentity;
let ModuleConvexError: typeof ConvexError;

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetAllMocks();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  mockAuth.isAuthenticated = false;
  mockAuth.isLoading = true;
  mockRevoked = false;
  mockSignIn.mockResolvedValue({ signingIn: true });
  mockSignOut.mockResolvedValue(undefined);
  mockStorage.clear();
  mockGetItem.mockImplementation(async (key: string) => mockStorage.get(key) ?? null);
  mockSetItem.mockImplementation(async (key: string, value: string) => {
    mockStorage.set(key, value);
  });
  mockDeleteItem.mockImplementation(async (key: string) => {
    mockStorage.delete(key);
  });
  mockAppAttest.generateKey.mockResolvedValue("new-key");
  mockAppAttest.attestKey.mockResolvedValue("attestation");
  mockChallenge.mockResolvedValue({ nonce: "nonce" });
  mockRandomBytes.mockResolvedValue(new Uint8Array(32).fill(0xa1));
  mockRegister.mockResolvedValue({
    deviceId: "device-1",
    attested: false,
    attestRequired: false,
  });
  mockAppAttest.isSupported.mockReturnValue(false);
  // Each isolated module represents a fresh process; remounts within a test share its promises.
  jest.isolateModules(() => {
    jest.doMock("react", () => React);
    ModuleConvexError = jest.requireActual<typeof import("convex/values")>("convex/values").ConvexError;
    identity = jest.requireActual<typeof import("./device-identity")>("./device-identity");
    ({ useDeviceIdentity } = identity);
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it("waits for stored auth, signs in anonymously, and registers once across remounts", async () => {
  const first = await renderHook(useDeviceIdentity);
  expect(mockSignIn).not.toHaveBeenCalled();
  expect(mockRegister).not.toHaveBeenCalled();

  mockAuth.isLoading = false;
  await first.rerender(undefined);
  expect(mockSignIn).toHaveBeenCalledWith("anonymous", {
    secret: "a1".repeat(32),
  });
  expect(mockRegister).not.toHaveBeenCalled();

  mockAuth.isAuthenticated = true;
  await first.rerender(undefined);
  expect(mockRegister).toHaveBeenCalledWith({
    platform: "simulator",
    appAttestKeyId: undefined,
  });
  await first.unmount();
  await renderHook(useDeviceIdentity);
  expect(mockRegister).toHaveBeenCalledTimes(1);
});

it("signs a session revoked by data deletion out, then signs the installation in again", async () => {
  mockAuth.isLoading = false;
  mockAuth.isAuthenticated = true;
  mockRevoked = true;
  mockRegister.mockRejectedValue(new ConvexError({ code: "session_revoked" }));
  const view = await renderHook(useDeviceIdentity);
  expect(mockSignOut).toHaveBeenCalledTimes(1);

  mockAuth.isAuthenticated = false;
  mockRevoked = undefined;
  await view.rerender(undefined);
  expect(mockSignIn).toHaveBeenCalledWith("anonymous", { secret: "a1".repeat(32) });
  expect(mockReportError).not.toHaveBeenCalled();
});

it("holds sign-in while the installation is erased, then signs in with a new secret", async () => {
  mockAuth.isLoading = false;
  mockStorage.set("deviceAuthSecret", "a1".repeat(32));
  mockStorage.set("appAttestKeyId", "old-key");
  identity.suspendDeviceIdentity();
  await renderHook(useDeviceIdentity);
  expect(mockSignIn).not.toHaveBeenCalled();

  await identity.forgetDeviceIdentity();
  mockRandomBytes.mockResolvedValue(new Uint8Array(32).fill(0xb2));
  await act(() => identity.resumeDeviceIdentity());
  expect(mockStorage.has("appAttestKeyId")).toBe(false);
  expect(mockSignIn).toHaveBeenCalledWith("anonymous", { secret: "b2".repeat(32) });
});

it("restores an existing session and passes the saved attestation key without signing in again", async () => {
  mockAuth.isLoading = false;
  mockAuth.isAuthenticated = true;
  mockGetItem.mockResolvedValue("saved-key");
  mockAppAttest.isSupported.mockReturnValue(true);
  mockRegister.mockResolvedValue({
    deviceId: "device-1",
    attested: true,
    attestRequired: true,
  });
  await renderHook(useDeviceIdentity);
  expect(mockSignIn).not.toHaveBeenCalled();
  expect(mockRegister).toHaveBeenCalledWith({
    platform: "simulator",
    appAttestKeyId: "saved-key",
  });
  expect(mockAppAttest.attestKey).not.toHaveBeenCalled();
});

it("does not request attestation on unsupported devices even when required by the server", async () => {
  mockAuth.isLoading = false;
  mockAuth.isAuthenticated = true;
  mockRegister.mockResolvedValue({
    deviceId: "device-1",
    attested: false,
    attestRequired: true,
  });
  await renderHook(useDeviceIdentity);
  expect(mockChallenge).not.toHaveBeenCalled();
});

it.each([false, true])("attests a supported phone when server enforcement is %s", async (attestRequired) => {
  mockAuth.isLoading = false;
  mockAuth.isAuthenticated = true;
  mockRegister.mockResolvedValue({
    deviceId: "device-1",
    attested: false,
    attestRequired,
  });
  mockAppAttest.isSupported.mockReturnValue(true);
  mockAppAttest.generateKey.mockResolvedValue("new-key");
  mockAppAttest.attestKey.mockResolvedValue("attestation");
  mockChallenge.mockResolvedValue({ nonce: "nonce" });
  await renderHook(useDeviceIdentity);
  expect(mockSetItem).toHaveBeenCalledWith("appAttestKeyId", "new-key");
  expect(mockAppAttest.attestKey).toHaveBeenCalledWith("new-key", "nonce");
  expect(mockAttest).toHaveBeenCalledWith({
    keyId: "new-key",
    attestationBase64: "attestation",
    nonce: "nonce",
  });
});

it("reuses a stored key when the server still needs its attestation", async () => {
  mockAuth.isLoading = false;
  mockAuth.isAuthenticated = true;
  mockStorage.set("appAttestKeyId", "saved-key");
  mockAppAttest.isSupported.mockReturnValue(true);
  await renderHook(useDeviceIdentity);
  expect(mockAppAttest.generateKey).not.toHaveBeenCalled();
  expect(mockAppAttest.attestKey).toHaveBeenCalledWith("saved-key", "nonce");
});

it.each(["key_mismatch", "invalid_attestation"])(
  "replaces a key rejected with %s once, using a fresh challenge",
  async (code) => {
    mockAuth.isLoading = false;
    mockAuth.isAuthenticated = true;
    mockStorage.set("appAttestKeyId", "saved-key");
    mockAppAttest.isSupported.mockReturnValue(true);
    mockChallenge.mockResolvedValueOnce({ nonce: "first" }).mockResolvedValueOnce({ nonce: "second" });
    mockAttest.mockRejectedValueOnce({ data: { code } });
    await renderHook(useDeviceIdentity);
    expect(mockDeleteItem).toHaveBeenCalledWith("appAttestKeyId");
    expect(mockAppAttest.attestKey.mock.calls).toEqual([
      ["saved-key", "first"],
      ["new-key", "second"],
    ]);
    expect(mockStorage.get("appAttestKeyId")).toBe("new-key");
    expect(mockAttest).toHaveBeenCalledTimes(2);
  },
);

it("stops key rotation after a second rejection", async () => {
  mockAuth.isLoading = false;
  mockAuth.isAuthenticated = true;
  mockAppAttest.isSupported.mockReturnValue(true);
  mockAttest.mockRejectedValue({ data: { code: "invalid_attestation" } });
  await renderHook(useDeviceIdentity);
  await act(() => jest.advanceTimersByTimeAsync(60_000));
  expect(mockAttest).toHaveBeenCalledTimes(2);
  expect(mockAppAttest.generateKey).toHaveBeenCalledTimes(2);
  expect(mockStorage.has("appAttestKeyId")).toBe(false);
});

it("retries the same proof when the server fails after Apple attests the key", async () => {
  mockAuth.isLoading = false;
  mockAuth.isAuthenticated = true;
  mockAppAttest.isSupported.mockReturnValue(true);
  mockAppAttest.attestKey
    .mockResolvedValueOnce("attestation")
    .mockRejectedValue({ code: "ERR_APP_INTEGRITY_INVALID_KEY" });
  mockAttest.mockRejectedValueOnce(new Error("offline"));
  await renderHook(useDeviceIdentity);
  await act(() => jest.advanceTimersByTimeAsync(1000));
  expect(mockAppAttest.generateKey).toHaveBeenCalledTimes(1);
  expect(mockAttest).toHaveBeenCalledTimes(2);
  expect(mockAttest.mock.calls[1]).toEqual(mockAttest.mock.calls[0]);
  expect(mockAppAttest.attestKey).toHaveBeenCalledTimes(1);
  expect(mockDeleteItem).not.toHaveBeenCalled();
});

it("does not call Apple until the new key is persisted", async () => {
  mockAuth.isLoading = false;
  mockAuth.isAuthenticated = true;
  mockAppAttest.isSupported.mockReturnValue(true);
  mockSetItem.mockRejectedValueOnce(new Error("keychain unavailable"));
  await renderHook(useDeviceIdentity);
  expect(mockAppAttest.attestKey).not.toHaveBeenCalled();
});

it("preserves the key and retries later when Apple is temporarily unavailable", async () => {
  mockAuth.isLoading = false;
  mockAuth.isAuthenticated = true;
  mockAppAttest.isSupported.mockReturnValue(true);
  mockChallenge.mockResolvedValueOnce({ nonce: "first" }).mockResolvedValueOnce({ nonce: "second" });
  mockAppAttest.attestKey.mockRejectedValueOnce({
    code: "ERR_APP_INTEGRITY_SERVER_UNAVAILABLE",
  });
  await renderHook(useDeviceIdentity);
  await act(() => jest.advanceTimersByTimeAsync(1000));
  expect(mockAppAttest.generateKey).toHaveBeenCalledTimes(1);
  expect(mockAppAttest.attestKey).toHaveBeenCalledTimes(2);
  expect(mockAppAttest.attestKey.mock.calls).toEqual([
    ["new-key", "first"],
    ["new-key", "first"],
  ]);
  expect(mockAttest).toHaveBeenCalledTimes(1);
});

it.each(["ERR_APP_INTEGRITY_INVALID_KEY", "ERR_APP_INTEGRITY_INVALID_INPUT", "ERR_APP_INTEGRITY_SYSTEM_FAILURE"])(
  "replaces a key Apple rejects with %s",
  async (code) => {
    mockAuth.isLoading = false;
    mockAuth.isAuthenticated = true;
    mockStorage.set("appAttestKeyId", "saved-key");
    mockAppAttest.isSupported.mockReturnValue(true);
    mockAppAttest.attestKey.mockRejectedValueOnce({ code });
    mockChallenge.mockResolvedValueOnce({ nonce: "first" }).mockResolvedValueOnce({ nonce: "second" });
    await renderHook(useDeviceIdentity);
    expect(mockAppAttest.attestKey.mock.calls).toEqual([
      ["saved-key", "first"],
      ["new-key", "second"],
    ]);
    expect(mockAttest).toHaveBeenCalledWith({ keyId: "new-key", nonce: "second", attestationBase64: "attestation" });
    expect(mockStorage.get("appAttestKeyId")).toBe("new-key");
    expect(mockReportError).not.toHaveBeenCalled();
  },
);

it.each(["ERR_APP_INTEGRITY_INVALID_KEY", "ERR_APP_INTEGRITY_INVALID_INPUT", "ERR_APP_INTEGRITY_SYSTEM_FAILURE"])(
  "bounds recovery when Apple repeatedly rejects keys with %s",
  async (code) => {
    mockAuth.isLoading = false;
    mockAuth.isAuthenticated = true;
    mockAppAttest.isSupported.mockReturnValue(true);
    const error = { code };
    mockAppAttest.attestKey.mockRejectedValue(error);
    await renderHook(useDeviceIdentity);
    await act(() => jest.advanceTimersByTimeAsync(60_000));
    expect(mockAppAttest.attestKey).toHaveBeenCalledTimes(2);
    expect(mockStorage.has("appAttestKeyId")).toBe(false);
    expect(console.warn).toHaveBeenCalledWith("Device identity setup failed", error);
    expect(mockReportError).toHaveBeenCalledWith(error, "auth.device_registration", {
      data: { attempt: 1, retrying: false },
    });
  },
);

it("replaces an expired attestation proof with a fresh key and challenge", async () => {
  mockAuth.isLoading = false;
  mockAuth.isAuthenticated = true;
  mockAppAttest.isSupported.mockReturnValue(true);
  mockAppAttest.generateKey.mockResolvedValueOnce("first-key").mockResolvedValueOnce("second-key");
  mockChallenge.mockResolvedValueOnce({ nonce: "first" }).mockResolvedValueOnce({ nonce: "second" });
  mockAttest.mockRejectedValueOnce({ data: { code: "challenge_invalid" } });
  await renderHook(useDeviceIdentity);
  expect(mockAppAttest.attestKey.mock.calls).toEqual([
    ["first-key", "first"],
    ["second-key", "second"],
  ]);
  expect(mockAttest).toHaveBeenCalledTimes(2);
  expect(mockStorage.get("appAttestKeyId")).toBe("second-key");
});

it("recovers after a process exits between native attestation and server registration", async () => {
  mockAuth.isLoading = false;
  mockAuth.isAuthenticated = true;
  mockAppAttest.isSupported.mockReturnValue(true);
  mockAppAttest.generateKey.mockResolvedValueOnce("first-key").mockResolvedValueOnce("second-key");
  const attestedKeys = new Set<string>();
  mockAppAttest.attestKey.mockImplementation(async (key: string) => {
    if (attestedKeys.has(key)) throw { code: "ERR_APP_INTEGRITY_INVALID_KEY" };
    attestedKeys.add(key);
    return "attestation";
  });
  mockAttest.mockRejectedValueOnce(new Error("offline"));
  const first = await renderHook(useDeviceIdentity);
  await first.unmount();
  jest.isolateModules(() => {
    identity = jest.requireActual<typeof import("./device-identity")>("./device-identity");
    ({ useDeviceIdentity } = identity);
  });
  await renderHook(useDeviceIdentity);
  expect(mockAttest).toHaveBeenCalledTimes(2);
  expect(mockStorage.get("appAttestKeyId")).toBe("second-key");
});

it("keeps the key when the server committed attestation but its response was lost", async () => {
  mockAuth.isLoading = false;
  mockAuth.isAuthenticated = true;
  mockAppAttest.isSupported.mockReturnValue(true);
  mockAttest.mockRejectedValueOnce(new Error("response lost"));
  mockRegister.mockResolvedValueOnce({ attested: false }).mockResolvedValue({ attested: true });
  await renderHook(useDeviceIdentity);
  await act(() => jest.advanceTimersByTimeAsync(1000));
  expect(mockAppAttest.attestKey).toHaveBeenCalledTimes(1);
  expect(mockAppAttest.generateKey).toHaveBeenCalledTimes(1);
  expect(mockDeleteItem).not.toHaveBeenCalled();
});

it("adopts the key the server attested when another backend replaced the saved one", async () => {
  mockAuth.isLoading = false;
  mockAuth.isAuthenticated = true;
  mockStorage.set("appAttestKeyId", "other-backend-key");
  mockAppAttest.isSupported.mockReturnValue(true);
  mockRegister.mockResolvedValue({
    deviceId: "device-1",
    attested: false,
    attestRequired: true,
    attestedKeyId: "server-key",
  });
  await renderHook(useDeviceIdentity);
  await act(() => jest.advanceTimersByTimeAsync(60_000));
  expect(mockStorage.get("appAttestKeyId")).toBe("server-key");
  expect(mockAppAttest.attestKey).not.toHaveBeenCalled();
  expect(mockAttest).not.toHaveBeenCalled();
  expect(mockRegister).toHaveBeenCalledTimes(1);
  expect(mockReportError).not.toHaveBeenCalled();
});

it.each(["sign-in", "registration"])("retries failed %s without needing a remount", async (stage) => {
  mockAuth.isLoading = false;
  mockAuth.isAuthenticated = stage === "registration";
  const request = stage === "registration" ? mockRegister : mockSignIn;
  request.mockRejectedValueOnce(new Error("offline"));
  await renderHook(useDeviceIdentity);
  expect(request).toHaveBeenCalledTimes(1);
  await act(() => jest.advanceTimersByTimeAsync(1000));
  expect(request).toHaveBeenCalledTimes(2);
});

it("waits for the server cooldown before retrying device registration", async () => {
  mockAuth.isLoading = false;
  mockAuth.isAuthenticated = true;
  mockRegister.mockRejectedValueOnce(
    new ModuleConvexError({ code: "rate_limited", name: "registerDevice", retryAfter: 120_000 }),
  );
  await renderHook(useDeviceIdentity);
  expect(mockRegister).toHaveBeenCalledTimes(1);

  await act(() => jest.advanceTimersByTimeAsync(119_999));
  expect(mockRegister).toHaveBeenCalledTimes(1);
  await act(() => jest.advanceTimersByTimeAsync(1));
  expect(mockRegister).toHaveBeenCalledTimes(2);
});

it("registers again after the anonymous session changes", async () => {
  mockAuth.isLoading = false;
  mockAuth.isAuthenticated = true;
  const hook = await renderHook(useDeviceIdentity);
  mockAuth.isAuthenticated = false;
  await hook.rerender(undefined);
  mockAuth.isAuthenticated = true;
  await hook.rerender(undefined);
  expect(mockRegister).toHaveBeenCalledTimes(2);
});

it("reuses the installation credential after session expiry and a process restart", async () => {
  mockAuth.isLoading = false;
  const first = await renderHook(useDeviceIdentity);
  expect(mockSignIn).toHaveBeenLastCalledWith("anonymous", {
    secret: "a1".repeat(32),
  });
  mockAuth.isAuthenticated = true;
  await first.rerender(undefined);
  await first.unmount();

  mockAuth.isAuthenticated = false;
  jest.isolateModules(() => {
    identity = jest.requireActual<typeof import("./device-identity")>("./device-identity");
    ({ useDeviceIdentity } = identity);
  });
  await renderHook(useDeviceIdentity);
  expect(mockSignIn).toHaveBeenCalledTimes(2);
  expect(mockSignIn).toHaveBeenLastCalledWith("anonymous", {
    secret: "a1".repeat(32),
  });
  expect(mockRandomBytes).toHaveBeenCalledTimes(1);
});

it("retries a failed sign-in with the credential already saved for that request", async () => {
  mockAuth.isLoading = false;
  mockSignIn.mockRejectedValueOnce(new Error("response lost"));
  await renderHook(useDeviceIdentity);
  await act(() => jest.advanceTimersByTimeAsync(1000));
  expect(mockSignIn.mock.calls).toEqual([
    ["anonymous", { secret: "a1".repeat(32) }],
    ["anonymous", { secret: "a1".repeat(32) }],
  ]);
  expect(mockRandomBytes).toHaveBeenCalledTimes(1);
});

it("waits for keychain persistence before making any sign-in request", async () => {
  mockAuth.isLoading = false;
  const failure = new Error("keychain unavailable");
  mockSetItem.mockRejectedValueOnce(failure);
  await renderHook(useDeviceIdentity);
  expect(mockSignIn).not.toHaveBeenCalled();
  expect(mockReportError).toHaveBeenCalledWith(failure, "auth.anonymous_sign_in", {
    data: { attempt: 1, retrying: true },
  });
  await act(() => jest.advanceTimersByTimeAsync(1000));
  expect(mockSignIn).toHaveBeenCalledWith("anonymous", {
    secret: "a1".repeat(32),
  });
});

it("does not rotate or retry when key generation has a system failure", async () => {
  mockAuth.isLoading = false;
  mockAuth.isAuthenticated = true;
  mockAppAttest.isSupported.mockReturnValue(true);
  const error = { code: "ERR_APP_INTEGRITY_SYSTEM_FAILURE" };
  mockAppAttest.generateKey.mockRejectedValue(error);
  await renderHook(useDeviceIdentity);
  await act(() => jest.advanceTimersByTimeAsync(60_000));
  expect(mockAppAttest.generateKey).toHaveBeenCalledTimes(1);
  expect(mockChallenge).not.toHaveBeenCalled();
  expect(mockAppAttest.attestKey).not.toHaveBeenCalled();
  expect(mockAttest).not.toHaveBeenCalled();
  expect(mockSetItem).not.toHaveBeenCalled();
  expect(mockDeleteItem).not.toHaveBeenCalled();
  expect(mockReportError).toHaveBeenCalledWith(error, "auth.device_registration", {
    data: { attempt: 1, retrying: false },
  });
});
