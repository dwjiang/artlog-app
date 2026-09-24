import { act, renderHook, waitFor } from "@testing-library/react-native";

import { takeProfileSetupOffer } from "./profile-setup-offer";
import { useAccount } from "./use-account";

const mockMutation = jest.fn();
const mockSignIn = jest.fn();
const mockEndSession = jest.fn();
const mockAnonymous = jest.fn();
const mockApple = jest.fn();
const mockSignPayload = jest.fn();
const mockPause = jest.fn();
const mockResume = jest.fn();
const mockClaim = jest.fn();
const mockAvailable = jest.fn();
const mockReportError = jest.fn();
const mockBreadcrumb = jest.fn();
const mockClearImages = jest.fn();
let mockAccount: {
  linked: boolean;
  deviceCount: number;
  accountId?: string;
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
jest.mock("expo-image", () => ({
  Image: { clearMemoryCache: () => mockClearImages() },
}));
jest.mock("@/lib/use-device-ready", () => ({ useDeviceReady: () => true }));
jest.mock("@/db/repos/settings", () => ({ setSetting: async () => {} }));
jest.mock("@/lib/convex-client", () => ({
  convex: {
    mutation: (fn: unknown, args: unknown) =>
      mockMutation(jest.requireActual("convex/server").getFunctionName(fn), args),
  },
}));
jest.mock("@/lib/attested-write", () => ({
  signPayload: (args: unknown) => mockSignPayload(args),
}));
jest.mock("@/lib/device-identity", () => ({
  signInAnonymously: (signIn: unknown) => mockAnonymous(signIn),
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

beforeEach(() => {
  jest.resetAllMocks();
  takeProfileSetupOffer();
  mockAccount = { linked: false, deviceCount: 0 };
  mockAvailable.mockResolvedValue(true);
  mockMutation.mockResolvedValue({ nonce: "apple-nonce" });
  mockApple.mockResolvedValue({
    identityToken: "apple-token",
    user: "apple-user",
  });
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
    appleUserId: "apple-user",
  });
  expect(mockMutation).toHaveBeenLastCalledWith("accounts:linkAccount", {
    appleUserId: "apple-user",
    nonce: "assertion-nonce",
    assertionBase64: "assertion",
  });
  expect(mockPause).toHaveBeenCalledTimes(1);
  expect(mockResume).toHaveBeenCalledTimes(1);
  expect(mockBreadcrumb.mock.calls).toEqual([["auth.apple_sign_in.start"], ["auth.apple_sign_in.success"]]);
  expect(mockReportError).not.toHaveBeenCalled();
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

it("deletes the account before restoring the anonymous device identity", async () => {
  const { result } = await renderHook(useAccount);
  await act(() => result.current.deleteAccount());
  expect(mockMutation).toHaveBeenCalledWith("accounts:deleteAccount", {});
  expect(mockClearImages).toHaveBeenCalledTimes(1);
  expect(mockAnonymous).toHaveBeenCalledWith(mockSignIn);
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
