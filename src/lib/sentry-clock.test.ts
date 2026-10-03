const originalPerformance = Object.getOwnPropertyDescriptor(globalThis, "performance")!;
const wallClock = 1_791_012_926_283;

afterEach(() => {
  Object.defineProperty(globalThis, "performance", originalPerformance);
  jest.restoreAllMocks();
});

function initializeClock() {
  let timestamp: () => number;
  jest.isolateModules(() => {
    jest.requireActual("./sentry-clock");
    timestamp = jest.requireActual<typeof import("@sentry/core")>("@sentry/core").timestampInSeconds;
  });
  return timestamp!;
}

it("keeps Sentry timestamps on the wall clock through repeated device sleeps", () => {
  const now = jest.spyOn(Date, "now").mockReturnValue(wallClock);
  const nativeNow = jest.fn(() => 2_111_794_942);
  const nativePerformance = { timeOrigin: 1_788_088_822_447, now: nativeNow };
  Object.defineProperty(globalThis, "performance", { configurable: true, value: nativePerformance });
  const timestamp = initializeClock();
  expect(timestamp()).toBe(wallClock / 1_000);
  expect(nativePerformance.timeOrigin).toBe(1_788_088_822_447);

  for (const sleep of [3_600_000, 86_400_000]) {
    now.mockReturnValue(wallClock + sleep + 200);
    nativeNow.mockReturnValue(2_111_795_142);
    expect(timestamp()).toBe((wallClock + sleep + 200) / 1_000);
  }
});

it("preserves React Native's performance clock and inherited origin getter", () => {
  jest.spyOn(Date, "now").mockReturnValue(wallClock);
  const nativeNow = jest.fn(() => 2_111_794_942.25);
  const nativePerformance = Object.create({
    get timeOrigin() {
      return 1_788_088_822_447;
    },
  });
  nativePerformance.now = nativeNow;
  Object.defineProperty(globalThis, "performance", { configurable: true, value: nativePerformance });
  initializeClock();
  expect(performance).toBe(nativePerformance);
  expect(performance.now).toBe(nativeNow);
  expect(performance.now()).toBe(2_111_794_942.25);
  expect(performance.timeOrigin).toBe(1_788_088_822_447);
  expect(Object.hasOwn(performance, "timeOrigin")).toBe(false);
});
