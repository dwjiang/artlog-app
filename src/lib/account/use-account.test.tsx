import { act, renderHook, waitFor } from "@testing-library/react-native";
import { ConvexError } from "convex/values";

import * as settings from "@/db/repos/settings";

import { takeProfileSetupOffer } from "./profile-setup-offer";
import { useAccount } from "./use-account";

const mockMutation = jest.fn();
const mockSignIn = jest.fn();
const mockEndSession = jest.fn();
const mockAnonymous = jest.fn();
const mockApple = jest.fn();
const mockGoogle = jest.fn();
const mockSignPayload = jest.fn();
const mockCanAttest = jest.fn();
const mockPause = jest.fn();
const mockResume = jest.fn();
const mockClaim = jest.fn();
const mockAvailable = jest.fn();
const mockReportError = jest.fn();
const mockBreadcrumb = jest.fn();
const mockClearImages = jest.fn();
const mockErase = jest.fn();
const mockSuspend = jest.fn();
const mockResumeIdentity = jest.fn();
const mockDismissAll = jest.fn();
const mockNavigate = jest.fn();
let mockAccount: {
  linked: boolean;
  deviceCount: number;
  accountId?: string;
  provider?: "apple" | "google";
  scope?: string;
};

jest.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: mockSignIn, signOut: mockEndSession }),
}));
jest.mock("convex/react", () => ({ useQuery: () => mockAccount }));
jest.mock("expo-apple-authentication", () => ({
  isAvailableAsync: () => mockAvailable(),
  signInAsync: (args: unknown) => mockApple(args),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  formatFullName: (name: { givenName: string | null; familyName: string | null }) =>
    [name.givenName, name.familyName].filter(Boolean).join(" "),
}));
jest.mock("@/lib/image-cache", () => ({ clearImageCaches: () => mockClearImages() }));
jest.mock("./google-sign-in", () => ({
  googleSignInAvailable: true,
  googleSignIn: () => mockGoogle(),
}));
jest.mock("./sign-in-presentation", () => ({ presentWhenActive: (present: () => unknown) => present() }));
jest.mock("@/lib/use-device-ready", () => ({ useDeviceReady: () => true }));
jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
jest.mock("@/lib/convex-client", () => ({
  convex: {
    mutation: (fn: unknown, args: unknown) =>
      mockMutation(jest.requireActual("convex/server").getFunctionName(fn), args),
  },
}));
jest.mock("@/lib/attested-write", () => ({
  canAttest: () => mockCanAttest(),
  signPayload: (args: unknown) => mockSignPayload(args),
}));
jest.mock("@/lib/device-identity", () => ({
  signInAnonymously: (signIn: unknown) => mockAnonymous(signIn),
  suspendDeviceIdentity: () => mockSuspend(),
  resumeDeviceIdentity: () => mockResumeIdentity(),
}));
jest.mock("./erase-local-data", () => ({ eraseLocalData: () => mockErase() }));
jest.mock("expo-router", () => ({
  router: { dismissAll: () => mockDismissAll(), navigate: (href: string) => mockNavigate(href) },
}));
jest.mock("./collection-sync", () => ({
  completeJournalClaim: (account: unknown) => mockClaim(account),
  pauseCollectionSync: () => mockPause(),
  resumeCollectionSync: () => mockResume(),
}));
jest.mock("@/lib/observability", () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
  addBreadcrumb: (...args: unknown[]) => mockBreadcrumb(...args),
}));

beforeEach(async () => {
  jest.restoreAllMocks();
  jest.resetAllMocks();
  await settings.removeSetting("safety-checks");
  takeProfileSetupOffer();
  mockAccount = { linked: false, deviceCount: 0 };
  mockAvailable.mockResolvedValue(true);
  mockCanAttest.mockReturnValue(true);
  mockMutation.mockResolvedValue({ nonce: "apple-nonce" });
  mockApple.mockResolvedValue({
    identityToken: "apple-token",
    user: "apple-user",
  });
  mockGoogle.mockResolvedValue({ identityToken: "google-token", user: "google-user", name: "Alex Morgan" });
  mockSignPayload.mockResolvedValue({
    nonce: "assertion-nonce",
    assertionBase64: "assertion",
  });
});

it("passes the challenge to native Apple sign-in and links after provider verification", async () => {
  const { result } = await renderHook(useAccount);
  await waitFor(() => expect(result.current.available).toBe(true));
  await act(() => result.current.signInWithApple());
  expect(mockApple).toHaveBeenCalledWith({
    nonce: "apple-nonce",
    requestedScopes: [0, 1],
  });
  expect(mockSignIn).toHaveBeenCalledWith("apple-native", {
    identityToken: "apple-token",
    nonce: "apple-nonce",
  });
  expect(mockSignPayload).toHaveBeenCalledWith({
    action: "linkAccount",
    provider: "apple",
    providerUserId: "apple-user",
  });
  expect(mockMutation).toHaveBeenLastCalledWith("accounts:linkAccount", {
    provider: "apple",
    providerUserId: "apple-user",
    nonce: "assertion-nonce",
    assertionBase64: "assertion",
  });
  expect(mockPause).toHaveBeenCalledTimes(1);
  expect(mockResume).toHaveBeenCalledTimes(1);
  expect(mockBreadcrumb.mock.calls).toEqual(
    expect.arrayContaining([["auth.apple_sign_in.start"], ["auth.apple_sign_in.success"]]),
  );
  expect(mockReportError).not.toHaveBeenCalled();
});

it("carries an onboarding allow to the account without overriding an answer it already has", async () => {
  await settings.setSetting("safety-checks", "on");
  const { result } = await renderHook(useAccount);
  await act(() => result.current.signInWithApple());
  expect(await settings.getSetting("safety-checks")).toBeUndefined();
  expect(mockMutation).toHaveBeenLastCalledWith("accounts:setSafetyChecks", { enabled: true, ifUnset: true });
  expect(mockReportError).not.toHaveBeenCalled();
});

it("applies an onboarding decline even when the account allowed safety checks before", async () => {
  await settings.setSetting("safety-checks", "off");
  const { result } = await renderHook(useAccount);
  await act(() => result.current.signInWithApple());
  expect(await settings.getSetting("safety-checks")).toBeUndefined();
  expect(mockMutation).toHaveBeenLastCalledWith("accounts:setSafetyChecks", { enabled: false });
  expect(mockReportError).not.toHaveBeenCalled();
});

it("does not carry a failed consent upload to the next account that signs in", async () => {
  await settings.setSetting("safety-checks", "on");
  const failure = new Error("Consent write failed");
  mockMutation.mockImplementation(async (name: string) => {
    if (name === "accounts:setSafetyChecks") throw failure;
    return { nonce: "apple-nonce" };
  });
  const { result } = await renderHook(useAccount);
  await act(() => result.current.signInWithApple());
  expect(result.current.error).toBeUndefined();
  expect(mockReportError).toHaveBeenCalledWith(failure, "social.safety_checks.carry");

  await act(() => result.current.signOut());
  mockMutation.mockResolvedValue({ nonce: "apple-nonce" });
  await act(() => result.current.signInWithGoogle());
  expect(mockMutation.mock.calls.filter(([name]) => name === "accounts:setSafetyChecks")).toHaveLength(1);
  expect(await settings.getSetting("safety-checks")).toBeUndefined();
});

it("consumes the guest answer before linking so an interrupted link cannot carry it to another account", async () => {
  await settings.setSetting("safety-checks", "on");
  let finish!: () => void;
  mockMutation.mockImplementation((name: string) =>
    name === "accounts:linkAccount"
      ? new Promise<void>((resolve) => (finish = resolve))
      : Promise.resolve({ nonce: "apple-nonce" }),
  );
  const { result } = await renderHook(useAccount);
  let signIn!: Promise<void>;
  await act(async () => {
    signIn = result.current.signInWithApple();
  });
  await waitFor(() => expect(mockMutation).toHaveBeenCalledWith("accounts:linkAccount", expect.anything()));
  expect(await settings.getSetting("safety-checks")).toBeUndefined();
  await act(async () => {
    finish();
    await signIn;
  });
});

it("does not link an account when its guest consent cannot be consumed", async () => {
  const failure = new Error("Disk unavailable");
  jest.spyOn(settings, "takeSetting").mockRejectedValueOnce(failure);
  const { result } = await renderHook(useAccount);
  await act(() => result.current.signInWithApple());
  expect(mockMutation).not.toHaveBeenCalledWith("accounts:linkAccount", expect.anything());
  expect(mockMutation).not.toHaveBeenCalledWith("accounts:setSafetyChecks", expect.anything());
  expect(result.current.error).toContain("try again");
});

it("verifies Google before linking its attested identity and offering profile setup", async () => {
  const { result } = await renderHook(useAccount);
  await act(() => result.current.signInWithGoogle());
  expect(mockMutation).toHaveBeenCalledWith("devices:createChallenge", { purpose: "google" });
  expect(mockSignIn).toHaveBeenCalledWith("google-native", { identityToken: "google-token", nonce: "apple-nonce" });
  expect(mockSignPayload).toHaveBeenCalledWith({
    action: "linkAccount",
    provider: "google",
    providerUserId: "google-user",
  });
  expect(mockMutation).toHaveBeenLastCalledWith("accounts:linkAccount", {
    provider: "google",
    providerUserId: "google-user",
    nonce: "assertion-nonce",
    assertionBase64: "assertion",
  });
  expect(takeProfileSetupOffer()).toEqual({ name: "Alex Morgan" });
  expect(mockSignIn.mock.invocationCallOrder[0]).toBeLessThan(mockSignPayload.mock.invocationCallOrder[0]);
  expect(mockResume).toHaveBeenCalledTimes(1);
});

it("dismisses Google cancellation without an error or success event", async () => {
  mockGoogle.mockResolvedValueOnce(null);
  const { result } = await renderHook(useAccount);
  await act(() => result.current.signInWithGoogle());
  expect(result.current.error).toBeUndefined();
  expect(result.current.busy).toBe(false);
  expect(mockSignIn).not.toHaveBeenCalled();
  expect(mockSignPayload).not.toHaveBeenCalled();
  expect(mockReportError).not.toHaveBeenCalled();
  expect(mockBreadcrumb).not.toHaveBeenCalledWith("auth.google_sign_in.success");
  expect(mockResume).toHaveBeenCalledTimes(1);
});

it("reports rejected Google verification without linking or offering a profile", async () => {
  const error = new Error("wrong audience");
  mockSignIn.mockRejectedValueOnce(error);
  const { result } = await renderHook(useAccount);
  await act(() => result.current.signInWithGoogle());
  expect(mockSignPayload).not.toHaveBeenCalled();
  expect(mockReportError).toHaveBeenCalledWith(error, "auth.google_sign_in");
  expect(result.current.error).toContain("try again");
  expect(takeProfileSetupOffer()).toBeUndefined();
});

it("prevents another provider from starting while Google sign-in is pending", async () => {
  let cancel: (value: null) => void = () => {};
  mockGoogle.mockReturnValueOnce(
    new Promise((resolve) => {
      cancel = resolve;
    }),
  );
  const { result } = await renderHook(useAccount);
  let pending: Promise<void>;
  await act(() => {
    pending = result.current.signInWithGoogle();
  });
  await act(() => result.current.signInWithApple());
  expect(result.current.busy).toBe(true);
  expect(mockApple).not.toHaveBeenCalled();
  await act(async () => {
    cancel(null);
    await pending;
  });
  expect(result.current.busy).toBe(false);
});

it("offers profile setup with the name Apple shares only on first authorization", async () => {
  mockApple.mockResolvedValueOnce({
    identityToken: "apple-token",
    user: "apple-user",
    fullName: { givenName: "Alex", familyName: "Morgan" },
  });
  const { result } = await renderHook(useAccount);
  await act(() => result.current.signInWithApple());
  expect(takeProfileSetupOffer()).toEqual({ name: "Alex Morgan" });
  mockApple.mockResolvedValueOnce({
    identityToken: "apple-token",
    user: "apple-user",
    fullName: { givenName: null, familyName: null },
  });
  await act(() => result.current.signInWithApple());
  expect(takeProfileSetupOffer()).toEqual({});
});

it("treats Apple cancellation as a normal dismissal without linking", async () => {
  mockApple.mockRejectedValueOnce({ code: "ERR_REQUEST_CANCELED" });
  const { result } = await renderHook(useAccount);
  await act(() => result.current.signInWithApple());
  expect(result.current.error).toBeUndefined();
  expect(result.current.busy).toBe(false);
  expect(mockSignIn).not.toHaveBeenCalled();
  expect(mockSignPayload).not.toHaveBeenCalled();
  expect(mockReportError).not.toHaveBeenCalled();
  expect(mockBreadcrumb).not.toHaveBeenCalledWith("auth.apple_sign_in.success");
  expect(takeProfileSetupOffer()).toBeUndefined();
});

it("does not link when token verification fails", async () => {
  const failure = new Error("invalid audience");
  mockSignIn.mockRejectedValueOnce(failure);
  const { result } = await renderHook(useAccount);
  await act(() => result.current.signInWithApple());
  expect(result.current.error).toContain("try again");
  expect(mockSignPayload).not.toHaveBeenCalled();
  expect(mockResume).toHaveBeenCalled();
  expect(mockReportError).toHaveBeenCalledWith(failure, "auth.apple_sign_in");
});

it.each(["signInWithApple", "signInWithGoogle"] as const)(
  "explains that %s is unavailable on a device that can't attest, before asking the provider",
  async (operation) => {
    mockCanAttest.mockReturnValue(false);
    const { result } = await renderHook(useAccount);
    await act(() => result.current[operation]());
    expect(result.current.error).toBe("Signing in isn’t available on this device. Use Artlog on your iPhone instead.");
    expect(mockApple).not.toHaveBeenCalled();
    expect(mockGoogle).not.toHaveBeenCalled();
    expect(mockSignIn).not.toHaveBeenCalled();
  },
);

it("asks to try again while this device's attestation isn't ready", async () => {
  mockSignPayload.mockRejectedValueOnce(new ConvexError({ code: "device_not_attested" }));
  const { result } = await renderHook(useAccount);
  await act(() => result.current.signInWithApple());
  expect(result.current.error).toBe("This device isn’t set up for Artlog yet. Try again in a moment.");
  expect(mockMutation).not.toHaveBeenCalledWith("accounts:linkAccount", expect.anything());
});

it("reports a native availability failure while keeping sign-in unavailable", async () => {
  const failure = new Error("Native availability failed");
  mockAvailable.mockRejectedValueOnce(failure);
  const { result } = await renderHook(useAccount);
  await waitFor(() =>
    expect(mockReportError).toHaveBeenCalledWith(failure, "auth.apple_availability", {
      level: "warning",
    }),
  );
  expect(result.current.available).toBe(false);
});

it.each(["signOut", "deleteAccount"] as const)("reports failed %s without ending the session", async (operation) => {
  const failure = new Error("Server failed");
  mockMutation.mockRejectedValueOnce(failure);
  const { result } = await renderHook(useAccount);
  await act(() => result.current[operation]());
  expect(mockReportError).toHaveBeenCalledWith(
    failure,
    operation === "signOut" ? "auth.sign_out" : "auth.delete_account",
  );
  expect(mockEndSession).not.toHaveBeenCalled();
  expect(mockResume).toHaveBeenCalledTimes(1);
});

it("unlinks, ends the session, and drops cached social photos before restoring the anonymous identity", async () => {
  const { result } = await renderHook(useAccount);
  await act(() => result.current.signOut());
  expect(mockMutation).toHaveBeenCalledWith("accounts:unlink", {});
  expect(mockEndSession).toHaveBeenCalledTimes(1);
  expect(mockClearImages).toHaveBeenCalledTimes(1);
  expect(mockAnonymous).toHaveBeenCalledWith(mockSignIn);
  expect(mockMutation.mock.invocationCallOrder[0]).toBeLessThan(mockEndSession.mock.invocationCallOrder[0]);
  expect(mockEndSession.mock.invocationCallOrder[0]).toBeLessThan(mockClearImages.mock.invocationCallOrder[0]);
  expect(mockClearImages.mock.invocationCallOrder[0]).toBeLessThan(mockAnonymous.mock.invocationCallOrder[0]);
});

it("leaves the session intact when unlink fails", async () => {
  mockMutation.mockRejectedValueOnce(new Error("offline"));
  const { result } = await renderHook(useAccount);
  await act(() => result.current.signOut());
  expect(mockEndSession).not.toHaveBeenCalled();
  expect(mockClearImages).not.toHaveBeenCalled();
  expect(mockAnonymous).not.toHaveBeenCalled();
  expect(result.current.error).toContain("try again");
});

it("deletes on the server, then erases this iPhone while identity setup waits, and returns home", async () => {
  const { result } = await renderHook(useAccount);
  await act(() => result.current.deleteAccount());
  const order = [mockSuspend, mockMutation, mockEndSession, mockErase, mockResumeIdentity, mockDismissAll].map(
    (mock) => mock.mock.invocationCallOrder[0],
  );
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(mockMutation).toHaveBeenCalledWith("accounts:deleteAccount", {});
  expect(mockApple).not.toHaveBeenCalled();
  expect(mockNavigate).toHaveBeenCalledWith("/");
  expect(result.current.error).toBeUndefined();
});

describe("deleting an Apple account", () => {
  beforeEach(() => {
    mockAccount = { linked: true, deviceCount: 1, accountId: "account", provider: "apple", scope: "account-scope" };
  });

  it("asks Apple for a fresh authorization code first and sends it with the deletion", async () => {
    mockApple.mockResolvedValueOnce({ authorizationCode: "fresh-code", user: "apple-user" });
    const { result } = await renderHook(useAccount);
    await act(() => result.current.deleteAccount());
    expect(mockApple).toHaveBeenCalledWith(undefined);
    expect(mockMutation).toHaveBeenCalledWith("accounts:deleteAccount", { appleAuthorizationCode: "fresh-code" });
    expect(mockApple.mock.invocationCallOrder[0]).toBeLessThan(mockClaim.mock.invocationCallOrder[0]);
    expect(mockErase).toHaveBeenCalledTimes(1);
  });

  it("keeps the account when the Apple prompt is cancelled", async () => {
    mockApple.mockRejectedValueOnce({ code: "ERR_REQUEST_CANCELED" });
    const { result } = await renderHook(useAccount);
    await act(() => result.current.deleteAccount());
    expect(mockMutation).not.toHaveBeenCalledWith("accounts:deleteAccount", expect.anything());
    expect(mockErase).not.toHaveBeenCalled();
    expect(mockReportError).not.toHaveBeenCalled();
    expect(result.current.error).toBeUndefined();
    expect(result.current.busy).toBe(false);
  });

  it("still deletes, reporting a warning, when Apple can't provide a code", async () => {
    const failure = Object.assign(new Error("No Apple Account"), { code: "ERR_REQUEST_UNKNOWN" });
    mockApple.mockRejectedValueOnce(failure);
    const { result } = await renderHook(useAccount);
    await act(() => result.current.deleteAccount());
    expect(mockReportError).toHaveBeenCalledWith(failure, "auth.apple_revocation_code", { level: "warning" });
    expect(mockMutation).toHaveBeenCalledWith("accounts:deleteAccount", { appleAuthorizationCode: undefined });
    expect(mockErase).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeUndefined();
  });
});

it("keeps this iPhone's data and resumes identity setup when the server deletion fails", async () => {
  mockMutation.mockRejectedValueOnce(new Error("offline"));
  const { result } = await renderHook(useAccount);
  await act(() => result.current.deleteAccount());
  expect(mockErase).not.toHaveBeenCalled();
  expect(mockResumeIdentity).toHaveBeenCalledTimes(1);
  expect(mockDismissAll).not.toHaveBeenCalled();
  expect(result.current.error).toContain("try again");
});

it("finishes an interrupted claim before disconnecting the account", async () => {
  mockAccount = {
    linked: true,
    deviceCount: 1,
    accountId: "account",
    scope: "account-scope",
  };
  const { result } = await renderHook(useAccount);
  await act(() => result.current.signOut());
  expect(mockClaim).toHaveBeenCalledWith(mockAccount);
  expect(mockClaim.mock.invocationCallOrder[0]).toBeLessThan(mockMutation.mock.invocationCallOrder[0]);
});
