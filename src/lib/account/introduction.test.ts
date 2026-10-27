import { act, renderHook, waitFor } from "@testing-library/react-native";

import { removeSetting, setSetting } from "@/db/repos/settings";

import { useIntroduction, WELCOME_SEEN_SETTING } from "./introduction";

const tabs = ["(tabs)", "(home)"];
let mockSegments = tabs;
jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
jest.mock("expo-router", () => ({ useSegments: () => mockSegments }));
let mockJudgesDemo = false;
jest.mock("@/lib/judges-demo", () => ({ isJudgesDemo: () => mockJudgesDemo }));

beforeEach(async () => {
  mockSegments = tabs;
  mockJudgesDemo = false;
  await removeSetting(WELCOME_SEEN_SETTING);
  await removeSetting("local-profile-name");
});

it("holds a new guest through the welcome and the sign-in it hands off to, then marks it ended for that launch", async () => {
  const { result, rerender } = await renderHook(() => useIntroduction());
  await act(async () => {});
  expect(result.current).toBe("pending");

  for (const top of ["welcome", "sign-in", "create-profile"]) {
    mockSegments = [top];
    await rerender({});
    expect(result.current).toBe("pending");
  }

  mockSegments = tabs;
  await rerender({});
  expect(result.current).toBe("justEnded");
  mockSegments = ["welcome"];
  await rerender({});
  expect(result.current).toBe("justEnded");
});

it("does not hold someone who completed onboarding on an earlier launch, even without a name", async () => {
  await setSetting(WELCOME_SEEN_SETTING, "true");
  const { result } = await renderHook(() => useIntroduction());
  await waitFor(() => expect(result.current).toBe("over"));
});

it("starts the judges' demo build as a launch that has just finished the welcome", async () => {
  mockJudgesDemo = true;
  const { result } = await renderHook(() => useIntroduction());
  expect(result.current).toBe("justEnded");
  await act(async () => {});
  expect(result.current).toBe("justEnded");
});
