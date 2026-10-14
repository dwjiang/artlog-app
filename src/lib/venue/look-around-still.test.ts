import { act, renderHook } from "@testing-library/react-native";

import { reportError } from "@/lib/observability";

import { useLookAroundStill } from "./look-around-still";

const mockSnapshot = jest.fn<Promise<string | null>, [number, number, number, number]>();
jest.mock("../../../modules/look-around/src", () => ({
  ...jest.requireActual("../../../modules/look-around/src"),
  getLookAround: () => ({ snapshot: mockSnapshot, open: jest.fn() }),
}));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));

// Stills last the app session, so every test uses places of its own.
const place = (id: string, lat: number) => ({ id, lat, lng: -122.4 });

function pendingStills() {
  const pending = new Map<number, { resolve: (uri: string | null) => void; reject: (cause: unknown) => void }>();
  mockSnapshot.mockImplementation((lat) => new Promise((resolve, reject) => pending.set(lat, { resolve, reject })));
  return pending;
}

const requestedLats = () => mockSnapshot.mock.calls.map(([lat]) => lat);

beforeEach(() => {
  mockSnapshot.mockReset();
  jest.mocked(reportError).mockClear();
});

it("renders two stills at a time and never asks for a place that stops being shown before its turn", async () => {
  const pending = pendingStills();
  const first = await renderHook(() => useLookAroundStill(place("first", 1), "small"));
  await renderHook(() => useLookAroundStill(place("second", 2), "small"));
  const scrolledAway = await renderHook(() => useLookAroundStill(place("scrolled-away", 3), "small"));
  await renderHook(() => useLookAroundStill(place("fourth", 4), "small"));
  expect(requestedLats()).toEqual([1, 2]);
  expect(first.result.current).toEqual({ uri: undefined, settled: false });

  await scrolledAway.unmount();
  await act(async () => pending.get(1)!.resolve("file:///first.jpg"));

  expect(first.result.current).toEqual({ uri: "file:///first.jpg", settled: true });
  expect(requestedLats()).toEqual([1, 2, 4]);
  await act(async () => {
    pending.get(2)!.resolve(null);
    pending.get(4)!.resolve(null);
  });
});

it("asks Apple once per place, including a place it has no imagery for", async () => {
  mockSnapshot.mockResolvedValue(null);
  const card = await renderHook(() => useLookAroundStill(place("no-imagery", 5), "small"));
  const page = await renderHook(() => useLookAroundStill(place("no-imagery", 5), "small"));

  expect(card.result.current).toEqual({ uri: undefined, settled: true });
  expect(page.result.current).toEqual({ uri: undefined, settled: true });
  expect(mockSnapshot).toHaveBeenCalledTimes(1);
});

it("tries again when the place is next shown after a failure, reporting only unexpected failures", async () => {
  mockSnapshot.mockRejectedValueOnce(Object.assign(new Error("Throttled"), { code: "ERR_LOOK_AROUND_THROTTLED" }));
  const throttled = await renderHook(() => useLookAroundStill(place("retried", 6), "small"));
  expect(throttled.result.current).toEqual({ uri: undefined, settled: true });
  expect(reportError).not.toHaveBeenCalled();
  await throttled.unmount();

  const failure = new Error("Snapshot failed");
  mockSnapshot.mockRejectedValueOnce(failure);
  const failed = await renderHook(() => useLookAroundStill(place("retried", 6), "small"));
  expect(reportError).toHaveBeenCalledWith(failure, "venue.look_around.still", { level: "warning" });
  await failed.unmount();

  mockSnapshot.mockResolvedValueOnce("file:///retried.jpg");
  const shown = await renderHook(() => useLookAroundStill(place("retried", 6), "small"));
  expect(shown.result.current).toEqual({ uri: "file:///retried.jpg", settled: true });
  expect(mockSnapshot).toHaveBeenCalledTimes(3);
});

it("keeps a large still apart from the small one, rendering each at its own size", async () => {
  mockSnapshot.mockImplementation(async (_lat, _lng, width) => `file:///still-${width}.jpg`);
  const row = await renderHook(() => useLookAroundStill(place("both-sizes", 7), "small"));
  const card = await renderHook(() => useLookAroundStill(place("both-sizes", 7), "large"));

  expect(row.result.current.uri).toBe("file:///still-400.jpg");
  expect(card.result.current.uri).toBe("file:///still-800.jpg");
  expect(mockSnapshot.mock.calls).toEqual([
    [7, -122.4, 400, 250],
    [7, -122.4, 800, 500],
  ]);
});

it.each(["file:///shared.jpg", null])(
  "shares an in-flight result of %p without blocking another museum",
  async (uri) => {
    const lat = uri ? 8 : 10;
    const resolves: ((uri: string | null) => void)[] = [];
    mockSnapshot.mockImplementation((requestedLat) =>
      requestedLat === lat ? new Promise((resolve) => resolves.push(resolve)) : Promise.resolve(null),
    );
    const museum = place(`shared-${lat}`, lat);
    const card = await renderHook(() => useLookAroundStill(museum, "large"));
    const page = await renderHook(() => useLookAroundStill(museum, "large"));
    await renderHook(() => useLookAroundStill(place(`other-${lat}`, lat + 1), "large"));
    const requests = requestedLats();

    await act(async () => {
      for (const resolve of resolves) resolve(uri);
    });

    expect(requests).toEqual([lat, lat + 1]);
    expect(card.result.current).toEqual({ uri: uri ?? undefined, settled: true });
    expect(page.result.current).toEqual(card.result.current);
  },
);

it("settles every subscriber after a shared failure and retries when another view mounts", async () => {
  const rejects: ((cause: unknown) => void)[] = [];
  mockSnapshot.mockImplementation(() => new Promise((_resolve, reject) => rejects.push(reject)));
  const museum = place("shared-failure", 12);
  const card = await renderHook(() => useLookAroundStill(museum, "large"));
  const page = await renderHook(() => useLookAroundStill(museum, "large"));
  const failure = new Error("Snapshot failed");

  await act(async () => {
    for (const reject of rejects) reject(failure);
  });

  expect(card.result.current).toEqual({ uri: undefined, settled: true });
  expect(page.result.current).toEqual(card.result.current);

  mockSnapshot.mockResolvedValueOnce("file:///shared-retry.jpg");
  const retry = await renderHook(() => useLookAroundStill(museum, "large"));
  expect(retry.result.current).toEqual({ uri: "file:///shared-retry.jpg", settled: true });
  expect(card.result.current).toEqual(retry.result.current);
  expect(page.result.current).toEqual(retry.result.current);
  expect(mockSnapshot).toHaveBeenCalledTimes(2);
  expect(reportError).toHaveBeenCalledTimes(1);
  expect(reportError).toHaveBeenCalledWith(failure, "venue.look_around.still", { level: "warning" });
});

it("keeps a queued request while another view still needs it", async () => {
  const pending = pendingStills();
  await renderHook(() => useLookAroundStill(place("queue-first", 13), "small"));
  await renderHook(() => useLookAroundStill(place("queue-second", 14), "small"));
  const museum = place("queue-shared", 15);
  const card = await renderHook(() => useLookAroundStill(museum, "large"));
  const page = await renderHook(() => useLookAroundStill(museum, "large"));

  await card.unmount();
  await act(async () => pending.get(13)!.resolve(null));
  expect(requestedLats()).toEqual([13, 14, 15]);
  await act(async () => {
    pending.get(14)!.resolve(null);
    pending.get(15)!.resolve("file:///queued.jpg");
  });
  expect(page.result.current).toEqual({ uri: "file:///queued.jpg", settled: true });
});
