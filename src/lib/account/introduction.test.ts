import { act, renderHook, waitFor } from "@testing-library/react-native";

import { removeSetting, setSetting } from "@/db/repos/settings";

import { useIntroductionOver, WELCOME_SEEN_SETTING } from "./introduction";

const tabs = ["(tabs)", "(home)"];
let mockSegments = tabs;
jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
jest.mock("expo-router", () => ({ useSegments: () => mockSegments }));

beforeEach(async () => {
  mockSegments = tabs;
  await removeSetting(WELCOME_SEEN_SETTING);
});

it("holds a new guest through the welcome and the sign-in it hands off to, until the tabs are back", async () => {
  const { result, rerender } = await renderHook(() => useIntroductionOver("device:new"));
  await act(async () => {});
  expect(result.current).toBe(false);

  for (const top of ["welcome", "sign-in", "create-profile"]) {
    mockSegments = [top];
    await rerender({});
    expect(result.current).toBe(false);
  }

  mockSegments = tabs;
  await rerender({});
  expect(result.current).toBe(true);
});

it("does not hold someone who saw the welcome on an earlier launch", async () => {
  await setSetting(WELCOME_SEEN_SETTING, "true");
  const { result } = await renderHook(() => useIntroductionOver("device:returning"));
  await waitFor(() => expect(result.current).toBe(true));
});

it("does not hold a signed-in account, which never gets the welcome", async () => {
  const { result } = await renderHook(() => useIntroductionOver("account:existing"));
  await waitFor(() => expect(result.current).toBe(true));
});
