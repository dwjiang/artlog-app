import { act, renderHook } from "@testing-library/react-native";
import type { FunctionReference } from "convex/server";
import { ConvexError } from "convex/values";

import { switchOwner } from "@/lib/account/owner-store";

import { useSocialSession } from "./use-social-session";

let mockAuthenticated = true;
let mockReady = true;
let mockToken: string | null = "token";
let mockOffline = false;
let mockAccount: unknown;
const mockRead = jest.fn();
jest.mock("@convex-dev/auth/react", () => ({ useAuthToken: () => mockToken }));
jest.mock("convex/react", () => ({ useConvexAuth: () => ({ isAuthenticated: mockAuthenticated }) }));
jest.mock("expo-network", () => ({
  useNetworkState: () => ({ isConnected: !mockOffline }),
}));
jest.mock("@/lib/use-device-ready", () => ({ useDeviceReady: () => mockReady }));
jest.mock("./use-social-query", () => ({
  useSocialQuery: (query: FunctionReference<"query">, args: unknown) => {
    const name = jest.requireActual("convex/server").getFunctionName(query);
    mockRead(name, args);
    const value = args === "skip" ? undefined : mockAccount;
    return {
      data: value instanceof Error ? undefined : value,
      error: value instanceof Error ? value : undefined,
      refresh: jest.fn(),
    };
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthenticated = true;
  mockReady = true;
  mockToken = "token";
  mockOffline = false;
  switchOwner("account:a", "scope-a");
  mockAccount = { linked: true, accountId: "a", profileId: "profile-a", claimComplete: true, scope: "scope-a" };
});

it("waits for authentication, a token, the device and this account's finished sign-in claim", async () => {
  mockAuthenticated = false;
  mockReady = false;
  const view = await renderHook(useSocialSession);
  expect(mockRead).toHaveBeenLastCalledWith("accounts:me", "skip");
  expect(view.result.current).toMatchObject({ status: "loading", prefetch: { public: false, profile: false } });
  mockAuthenticated = true;
  await view.rerender({});
  expect(mockRead).toHaveBeenLastCalledWith("accounts:me", {});
  expect(view.result.current.status).toBe("loading");
  mockReady = true;
  mockToken = null;
  await view.rerender({});
  expect(view.result.current.status).toBe("loading");
  mockToken = "token";
  mockAccount = { ...(mockAccount as object), claimComplete: false };
  await view.rerender({});
  expect(view.result.current).toMatchObject({
    status: "loading",
    profileId: undefined,
    prefetch: { public: false, profile: false },
  });
  mockAccount = { ...(mockAccount as object), claimComplete: true };
  await view.rerender({});
  expect(view.result.current).toMatchObject({ status: "ready", profileId: "profile-a" });
});

it("asks for the account alongside the device check and starts reads a ready account will make", async () => {
  mockReady = false;
  const answer = mockAccount;
  mockAccount = undefined;
  const view = await renderHook(useSocialSession);
  expect(mockRead).toHaveBeenLastCalledWith("accounts:me", {});
  expect(view.result.current).toMatchObject({ status: "loading", prefetch: { public: true, profile: true } });
  mockAccount = answer;
  await view.rerender({});
  expect(view.result.current).toMatchObject({ status: "loading", prefetch: { public: true, profile: true } });
  mockReady = true;
  await view.rerender({});
  expect(view.result.current).toMatchObject({
    status: "ready",
    profileId: "profile-a",
    prefetch: { public: false, profile: false },
  });
});

it.each([
  ["a deleted profile", { profileId: null }],
  ["an account signed out elsewhere", { linked: false, accountId: null, profileId: null, scope: "device-scope" }],
])("stops profile reads once the account check finds %s", async (_, answer) => {
  mockReady = false;
  mockAccount = undefined;
  const view = await renderHook(useSocialSession);
  expect(view.result.current.prefetch).toEqual({ public: true, profile: true });
  mockAccount = { linked: true, accountId: "a", claimComplete: true, ...answer };
  await view.rerender({});
  expect(view.result.current).toMatchObject({ status: "loading", prefetch: { public: true, profile: false } });
});

it("starts only public reads for a guest and keeps a first launch loading until its device registers", async () => {
  switchOwner("device:test-installation");
  mockReady = false;
  mockAccount = undefined;
  const view = await renderHook(useSocialSession);
  expect(view.result.current).toMatchObject({ status: "loading", prefetch: { public: true, profile: false } });
  mockAccount = { linked: false, accountId: null, profileId: null, claimComplete: true, scope: "" };
  await view.rerender({});
  expect(view.result.current).toMatchObject({ status: "loading", prefetch: { public: true, profile: false } });
  mockReady = true;
  mockAccount = { ...(mockAccount as object), scope: "device-scope" };
  await view.rerender({});
  expect(view.result.current).toMatchObject({ status: "signed-out", prefetch: { public: false, profile: false } });
});

it.each([
  ["offline", () => (mockOffline = true)],
  ["failing", () => (mockAccount = new ConvexError({ code: "device_banned" }))],
])("starts no reads while %s", async (_, arrange) => {
  mockReady = false;
  arrange();
  const view = await renderHook(useSocialSession);
  expect(view.result.current.prefetch).toEqual({ public: false, profile: false });
});

it("is ready on a cold start before the journal sync restores the server scope, without reading the wall", async () => {
  switchOwner("account:a");
  const view = await renderHook(useSocialSession);
  expect(view.result.current).toMatchObject({ status: "ready", profileId: "profile-a", accountReady: true });
  expect(mockRead.mock.calls.map(([name]) => name)).toEqual(["accounts:me"]);
});

it("keeps its identity when journal sync restores the scope, but changes it for a new server scope or account", async () => {
  switchOwner("account:a");
  const view = await renderHook(useSocialSession);
  const initialKey = view.result.current.key;
  expect(view.result.current).toMatchObject({ status: "ready", scope: "scope-a" });
  await act(() => switchOwner("account:a", "scope-a"));
  expect(view.result.current.key).toBe(initialKey);
  mockAccount = { ...(mockAccount as object), scope: "scope-a-next" };
  await view.rerender({});
  expect(view.result.current.key).not.toBe(initialKey);
  const nextKey = view.result.current.key;
  await act(() => {
    switchOwner("account:b", "scope-b");
    switchOwner("account:a", "scope-a-next");
  });
  expect(view.result.current.key).not.toBe(nextKey);
});

it("clears identity on account changes, sign-out, and offline transitions", async () => {
  const view = await renderHook(useSocialSession);
  expect(view.result.current.profileId).toBe("profile-a");
  await act(() => switchOwner("account:b", "scope-b"));
  expect(view.result.current).toMatchObject({
    status: "loading",
    profileId: undefined,
    prefetch: { public: false, profile: false },
  });
  mockAccount = { linked: false, accountId: null, profileId: null, claimComplete: true, scope: "device-scope" };
  await act(() => switchOwner("device:test-installation", "device-scope"));
  expect(view.result.current.status).toBe("signed-out");
  mockOffline = true;
  await view.rerender({});
  expect(view.result.current.status).toBe("offline");
  expect(mockRead).toHaveBeenLastCalledWith("accounts:me", "skip");
});

it("offers profile creation when the account has no usable profile and reports failures", async () => {
  mockAccount = { ...(mockAccount as object), profileId: null };
  const view = await renderHook(useSocialSession);
  expect(view.result.current.status).toBe("profile-required");
  mockAccount = new ConvexError({ code: "not_found" });
  await view.rerender({});
  expect(view.result.current.status).toBe("error");
});
