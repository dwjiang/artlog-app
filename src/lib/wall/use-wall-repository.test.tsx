import { act, renderHook } from "@testing-library/react-native";
import { StrictMode } from "react";
import { switchOwner } from "../account/owner-store";
import { useWallRepository } from "./use-wall-repository";

let mockToken = "token-a";
const mockGetMine = jest.fn();
jest.mock("@convex-dev/auth/react", () => ({ useAuthToken: () => mockToken }));
jest.mock("expo-network", () => ({
  getNetworkStateAsync: async () => ({
    isConnected: true,
    isInternetReachable: true,
  }),
}));
jest.mock("./wall-transport", () => ({
  createWallTransport: () => ({
    getMine: (...args: unknown[]) => mockGetMine(...args),
  }),
}));

it("survives React effect replay, preserves drafts on token refresh, and clears on account changes", async () => {
  switchOwner("account:a", "account:a:1");
  mockGetMine.mockResolvedValue({
    scope: "account:a:1",
    profileId: "profile-a",
    revision: 1,
    color: "#45524B",
    items: [],
  });
  const view = await renderHook(useWallRepository, {
    wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
  });
  await act(async () => {
    await view.result.current.repository.refresh();
  });
  await act(() => {
    view.result.current.repository.setLayoutDraft({
      color: "#123456",
      items: [],
    });
  });
  mockToken = "token-refreshed";
  await view.rerender({});
  expect(view.result.current.layoutDraft?.color).toBe("#123456");
  await act(async () => {
    await view.result.current.repository.refresh();
  });
  expect(mockGetMine.mock.calls.at(-1)?.[0].token).toBe("token-refreshed");
  await act(() => {
    switchOwner("account:b", "account:b:1");
  });
  expect(view.result.current.acknowledged).toBeNull();
  expect(view.result.current.layoutDraft).toBeNull();
  await view.unmount();
});
