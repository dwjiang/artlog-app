import { act, renderHook } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import { useToggleBounce } from "./use-symbol-bounce";

type Bounce = { effect: { direction: string }; trigger: { get(): number } };
jest.mock("@expo/ui/swift-ui/modifiers", () => ({
  symbolEffect: (effect: unknown, args: { value: unknown }) => ({ effect, trigger: args.value }),
}));

let reduceMotion: boolean;
beforeEach(() => {
  reduceMotion = false;
  jest.useFakeTimers();
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockImplementation(async () => reduceMotion);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function renderToggle(on: boolean | undefined) {
  const view = await renderHook((value: boolean | undefined) => useToggleBounce(value), { initialProps: on });
  const bounce = () => view.result.current?.[0] as Bounce | undefined;
  const toggle = async (value: boolean | undefined) => {
    await view.rerender(value);
    await act(() => jest.runOnlyPendingTimers());
  };
  return { bounce, toggle };
}

it("bounces up on each turn-on and down on each turn-off, never as the state loads", async () => {
  const { bounce, toggle } = await renderToggle(undefined);
  await toggle(true);
  expect(bounce()?.trigger.get()).toBe(0);

  await toggle(false);
  expect(bounce()).toMatchObject({ effect: { effect: "bounce", direction: "down" } });
  expect(bounce()?.trigger.get()).toBe(1);

  await toggle(true);
  expect(bounce()).toMatchObject({ effect: { direction: "up" } });
  expect(bounce()?.trigger.get()).toBe(2);
});

it("leaves the symbol still with Reduce Motion on", async () => {
  reduceMotion = true;
  const { bounce, toggle } = await renderToggle(false);
  await toggle(true);
  expect(bounce()).toBeUndefined();
});
