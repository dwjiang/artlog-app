import { act, renderHook } from "@testing-library/react-native";
import { setUpTests } from "react-native-reanimated";

import { useGeneratedRange } from "./use-generated-range";

jest.unmock("react-native-reanimated");
jest.mock("@/hooks/use-reduced-motion", () => ({ useReducedMotion: () => false }));

setUpTests();

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it.each([
  { available: 0, scale: 0, expected: 0 },
  { available: 48, scale: 24, expected: 1 },
])("bounds the loaded fraction with $available seconds available on a $scale-second scale", async (props) => {
  const { result } = await renderHook(() => useGeneratedRange(props.available, props.scale));
  expect(result.current.get()).toBe(props.expected);
});

it("keeps a full loaded range full as live audio extends the progress scale", async () => {
  const { result, rerender } = await renderHook(
    ({ available, scale }: { available: number; scale: number }) => useGeneratedRange(available, scale),
    { initialProps: { available: 76, scale: 76 } },
  );
  expect(result.current.get()).toBe(1);
  await rerender({ available: 78, scale: 78 });
  expect(result.current.get()).toBe(1);
  await act(() => jest.advanceTimersByTime(1000));
  expect(result.current.get()).toBe(1);
});

it("continues forward when availability crosses the estimated duration mid-sweep", async () => {
  const { result, rerender } = await renderHook(
    ({ available, scale }: { available: number; scale: number }) => useGeneratedRange(available, scale),
    { initialProps: { available: 70, scale: 76 } },
  );
  await rerender({ available: 74, scale: 76 });
  await act(() => jest.advanceTimersByTime(1000));
  const inFlight = result.current.get();
  expect(inFlight).toBeGreaterThan(70 / 76);
  expect(inFlight).toBeLessThan(74 / 76);
  await rerender({ available: 78, scale: 78 });
  expect(result.current.get()).toBeCloseTo(inFlight);
  await act(() => jest.advanceTimersByTime(1000));
  expect(result.current.get()).toBeGreaterThan(inFlight);
  await act(() => jest.advanceTimersByTime(1100));
  expect(result.current.get()).toBe(1);
});

it("clears immediately when a narration finishes or changes during a sweep", async () => {
  const { result, rerender } = await renderHook(
    ({ available }: { available: number }) => useGeneratedRange(available, 76),
    { initialProps: { available: 20 } },
  );
  await rerender({ available: 40 });
  await act(() => jest.advanceTimersByTime(500));
  await rerender({ available: 0 });
  expect(result.current.get()).toBe(0);
  await act(() => jest.advanceTimersByTime(2000));
  expect(result.current.get()).toBe(0);
});
