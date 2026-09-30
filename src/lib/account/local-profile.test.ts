import { act, renderHook, waitFor } from "@testing-library/react-native";

import { removeSetting } from "@/db/repos/settings";

import { getLocalProfileName, setLocalProfileName, useLocalProfileName } from "./local-profile";
import { anonymousOwner, switchOwner } from "./owner-store";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));

beforeEach(async () => {
  await removeSetting("local-profile-name");
  switchOwner(anonymousOwner());
});

it("keeps the chosen name across fresh reads and account changes", async () => {
  expect(await getLocalProfileName()).toBeUndefined();
  await setLocalProfileName("  Alex Rivera  ");
  switchOwner("account:alex");
  expect(await getLocalProfileName()).toBe("Alex Rivera");
  switchOwner(anonymousOwner());
  await jest.isolateModulesAsync(async () => {
    const profile = jest.requireActual<typeof import("./local-profile")>("./local-profile");
    expect(await profile.getLocalProfileName()).toBe("Alex Rivera");
  });
});

it.each(["", "   ", "a".repeat(61)])("rejects an invalid name without replacing the saved name", async (name) => {
  await setLocalProfileName("Alex");
  await expect(setLocalProfileName(name)).rejects.toThrow("Enter a name");
  expect(await getLocalProfileName()).toBe("Alex");
});

it("updates mounted profiles after saving and restores the name on remount", async () => {
  const first = await renderHook(useLocalProfileName);
  await waitFor(() => expect(first.result.current.loading).toBe(false));
  await act(() => setLocalProfileName("Alex"));
  expect(first.result.current.name).toBe("Alex");
  await first.unmount();
  const next = await renderHook(useLocalProfileName);
  await waitFor(() => expect(next.result.current).toEqual({ name: "Alex", loading: false }));
});
