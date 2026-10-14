import { act, renderHook } from "@testing-library/react-native";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { fetch as expoFetch } from "expo/fetch";
import { Alert, type AlertButton } from "react-native";

import { switchOwner } from "@/lib/account/owner-store";
import { reportError } from "@/lib/observability";
import { showErrorToast, showToast } from "@/lib/ui/toast";

import { useBlock } from "./use-block";
import type { SocialSession } from "./use-social-session";

const mockMutation = jest.fn();
const mockOptions = jest.fn();
jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));
jest.mock("convex/browser", () => ({
  ConvexHttpClient: function (_url: string, options: object) {
    mockOptions(options);
    return { mutation: mockMutation };
  },
}));
jest.mock("@/lib/ui/toast", () => ({ showToast: jest.fn(), showErrorToast: jest.fn() }));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));

const session: SocialSession = {
  key: "scope-a",
  token: "token-a",
  profileId: "viewer" as never,
  status: "ready",
  offline: false,
  accountReady: true,
  safetyChecks: true,
  error: undefined,
  refresh: jest.fn(),
};
const jamie = { profileId: "jamie" as never, name: "Jamie Chen" };
const alert = jest.spyOn(Alert, "alert");
const choose = async (label: string) => {
  const buttons: AlertButton[] = alert.mock.calls.at(-1)?.[2] ?? [];
  await act(async () => {
    buttons.find((button) => button.text === label)?.onPress?.();
  });
};
beforeEach(() => {
  jest.clearAllMocks();
  switchOwner("account:a", "scope-a");
  mockMutation.mockResolvedValue({});
});

it("asks before blocking, then blocks through the account’s token and confirms", async () => {
  const { result } = await renderHook(() => useBlock(session));
  await act(() => result.current.block(jamie));
  expect(alert.mock.calls[0]?.[0]).toBe("Block Jamie Chen?");
  await choose("Cancel");
  expect(mockMutation).not.toHaveBeenCalled();
  await act(() => result.current.block(jamie));
  await choose("Block");
  const [reference, args, options] = mockMutation.mock.calls[0];
  expect([getFunctionName(reference), args, options]).toEqual([
    "friendships:block",
    { scope: "scope-a", profileId: "jamie" },
    { skipQueue: true },
  ]);
  expect(mockOptions).toHaveBeenCalledWith(expect.objectContaining({ auth: "token-a" }));
  expect(showToast).toHaveBeenCalledWith("Blocked Jamie Chen.");
  expect(result.current.pending).toBeUndefined();
});

it("offers a retry when unblocking fails and reports only unexpected failures", async () => {
  mockMutation.mockRejectedValueOnce(new Error("Network request failed"));
  const { result } = await renderHook(() => useBlock(session));
  await act(() => result.current.unblock(jamie, 3));
  expect(alert.mock.calls[0]?.[0]).toBe("Unblock Jamie Chen?");
  await choose("Unblock");
  expect(reportError).not.toHaveBeenCalled();
  const [message, retry] = jest.mocked(showErrorToast).mock.calls[0];
  expect(message).toBe("Couldn’t unblock Jamie Chen.");
  await act(async () => retry?.());
  expect(getFunctionName(mockMutation.mock.calls[1][0])).toBe("friendships:unblock");
  expect(mockMutation.mock.calls[0][1]).toEqual({ scope: "scope-a", profileId: "jamie", blockRevision: 3 });
  expect(mockMutation.mock.calls[1][1]).toEqual(mockMutation.mock.calls[0][1]);
  expect(showToast).toHaveBeenCalledWith("Unblocked Jamie Chen.");

  mockMutation.mockRejectedValueOnce(new ConvexError({ code: "not_found" }));
  await act(() => result.current.block(jamie));
  await choose("Block");
  expect(reportError).toHaveBeenCalledWith(expect.any(ConvexError), "friendship.block");
});

it("drops the confirmation of a change that finishes after the account switched", async () => {
  let finish: () => void = () => {};
  mockMutation.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));
  const { result } = await renderHook(() => useBlock(session));
  await act(() => result.current.block(jamie));
  await choose("Block");
  expect(result.current.pending).toBe("jamie");
  await act(() => switchOwner("account:b", "scope-b"));
  await act(async () => finish());
  expect(showToast).not.toHaveBeenCalled();
});

it.each(["block", "unblock"] as const)(
  "ignores a deferred %s confirmation after the account changes",
  async (action) => {
    const { result, rerender } = await renderHook(({ current }: { current: SocialSession }) => useBlock(current), {
      initialProps: { current: session },
    });
    await act(() => result.current[action](jamie, 1));
    await act(() => switchOwner("account:b", "scope-b"));
    await rerender({ current: { ...session, key: "scope-b", token: "token-b" } });
    await choose(action === "block" ? "Block" : "Unblock");
    expect(mockMutation.mock.calls.length).toBe(0);
    expect(showToast).not.toHaveBeenCalled();
    expect(showErrorToast).not.toHaveBeenCalled();
  },
);

it.each(["block", "unblock"] as const)(
  "ignores a %s retry after leaving and returning to the account",
  async (action) => {
    mockMutation.mockRejectedValueOnce(new Error("Network request failed"));
    const { result } = await renderHook(() => useBlock(session));
    await act(() => result.current[action](jamie, 1));
    await choose(action === "block" ? "Block" : "Unblock");
    const retry = jest.mocked(showErrorToast).mock.calls[0][1];
    await act(() => {
      switchOwner("account:b", "scope-b");
      switchOwner("account:a", "scope-a");
    });
    await act(async () => retry?.());
    expect(mockMutation).toHaveBeenCalledTimes(1);
    expect(showToast).not.toHaveBeenCalled();
    expect(showErrorToast).toHaveBeenCalledTimes(1);
  },
);

it.each(["owner change", "unmount"] as const)("aborts an outstanding request on %s", async (event) => {
  let fail: (error: Error) => void = () => {};
  mockMutation.mockReturnValueOnce(new Promise((_, reject) => (fail = reject)));
  const { result, unmount } = await renderHook(() => useBlock(session));
  await act(() => result.current.block(jamie));
  await choose("Block");
  mockOptions.mock.calls[0][0].fetch("https://example.test", {});
  const signal = jest.mocked(expoFetch).mock.calls.at(-1)?.[1]?.signal;
  expect(signal?.aborted).toBe(false);
  if (event === "owner change") await act(() => switchOwner("account:b", "scope-b"));
  else await unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => fail(new Error("The operation was aborted.")));
  expect(showToast).not.toHaveBeenCalled();
  expect(showErrorToast).not.toHaveBeenCalled();
  expect(reportError).not.toHaveBeenCalled();
});

it("requires a new decision after a stale unblock conflicts", async () => {
  mockMutation.mockRejectedValueOnce(new ConvexError({ code: "conflict" }));
  const { result } = await renderHook(() => useBlock(session));
  await act(() => result.current.unblock(jamie, 1));
  await choose("Unblock");
  expect(showErrorToast).toHaveBeenCalledWith("This block changed. Review its current status before trying again.");
  expect(showToast).not.toHaveBeenCalled();
});
