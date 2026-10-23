import { act, renderHook } from "@testing-library/react-native";
import { getFunctionName } from "convex/server";
import { Alert, type AlertButton } from "react-native";

import { switchOwner } from "@/lib/account/owner-store";
import { useBlock } from "@/lib/social/use-block";
import { useFriendship } from "@/lib/social/use-friendship";
import { useSocialSession } from "@/lib/social/use-social-session";

const mockMutation = jest.fn();
jest.mock("@convex-dev/auth/react", () => ({ useAuthToken: () => "token-a" }));
jest.mock("convex/react", () => ({ useConvexAuth: () => ({ isAuthenticated: true }) }));
jest.mock("expo-network", () => ({ useNetworkState: () => ({ isConnected: true }) }));
jest.mock("@/lib/use-device-ready", () => ({ useDeviceReady: () => true }));
jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));
jest.mock("convex/browser", () => ({
  ConvexHttpClient: function () {
    return { mutation: mockMutation };
  },
}));
jest.mock("@/lib/ui/toast", () => ({ showToast: jest.fn(), showErrorToast: jest.fn() }));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));
jest.mock("@/lib/ui/haptics");
jest.mock("@/lib/notifications/offer", () => ({ offerNotifications: jest.fn() }));
jest.mock("@/lib/social/use-social-query", () => ({
  useSocialQuery: (query: unknown, args: unknown) => {
    const name = jest.requireActual("convex/server").getFunctionName(query);
    const data =
      name === "accounts:me"
        ? { linked: true, accountId: "a", profileId: "viewer", claimComplete: true, scope: "scope-a" }
        : { state: "none", revision: 0, requesterId: null, blocked: false, blockRevision: 0 };
    return { data: args === "skip" ? undefined : data, error: undefined, refresh: jest.fn() };
  },
}));

const jamie = { profileId: "jamie" as never, name: "Jamie Chen" };
const alert = jest.spyOn(Alert, "alert");

beforeEach(() => {
  jest.clearAllMocks();
  switchOwner("account:a");
  mockMutation.mockReset().mockResolvedValue({});
});

it.each([
  ["block", false],
  ["unblock", false],
  ["block", true],
  ["unblock", true],
] as const)("submits a confirmed %s when sync restores its scope during confirmation: %s", async (action, restore) => {
  const { result } = await renderHook(() => {
    const session = useSocialSession();
    return { session, blocking: useBlock(session) };
  });
  expect(result.current.session.status).toBe("ready");
  await act(() => result.current.blocking[action](jamie, 0));
  const label = action === "block" ? "Block" : "Unblock";
  expect(alert.mock.calls.at(-1)?.[0]).toBe(`${label} Jamie Chen?`);
  if (restore) await act(() => switchOwner("account:a", "scope-a"));
  const buttons: AlertButton[] = alert.mock.calls.at(-1)?.[2] ?? [];
  await act(async () => {
    buttons.find((button) => button.text === label)?.onPress?.();
  });
  expect(mockMutation).toHaveBeenCalledTimes(1);
  expect(getFunctionName(mockMutation.mock.calls[0][0])).toBe(`friendships:${action}`);
  expect(mockMutation.mock.calls[0][1]).toMatchObject({ scope: "scope-a", profileId: jamie.profileId });
});

it("clears a pending friendship action after the same account restores its journal scope", async () => {
  let finish!: (value: unknown) => void;
  mockMutation.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { result } = await renderHook(() => {
    const session = useSocialSession();
    return { session, friendship: useFriendship(jamie.profileId, session) };
  });
  expect(result.current.session.status).toBe("ready");
  await act(() => {
    void result.current.friendship.act("request");
  });
  expect(result.current.friendship.pending).toBe("request");
  await act(() => switchOwner("account:a", "scope-a"));
  await act(() => finish({ state: "pending", revision: 1, requesterId: "viewer", blocked: false, blockRevision: 0 }));
  expect(result.current.session.status).toBe("ready");
  expect(result.current.friendship.pending).toBeUndefined();
});

it("submits blocking and completes friendship actions when sync already restored the scope", async () => {
  switchOwner("account:a", "scope-a");
  const { result } = await renderHook(() => {
    const session = useSocialSession();
    return { session, blocking: useBlock(session), friendship: useFriendship(jamie.profileId, session) };
  });
  await act(() => result.current.blocking.block(jamie));
  const buttons: AlertButton[] = alert.mock.calls.at(-1)?.[2] ?? [];
  await act(async () => {
    buttons.find((button) => button.text === "Block")?.onPress?.();
  });
  expect(mockMutation).toHaveBeenCalledTimes(1);
  await act(() => result.current.friendship.act("request"));
  expect(mockMutation).toHaveBeenCalledTimes(2);
  expect(result.current.friendship.pending).toBeUndefined();
});
