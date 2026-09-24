import { ConvexError } from "convex/values";

import type { PendingScan } from "@/db/schema";
import type { IdentifyResponse } from "@/lib/capture/stages";
import { reportError } from "@/lib/observability";

import type { Id } from "../../../convex/_generated/dataModel";
import { createFlusher, type FlushDependencies } from "./flush";

jest.mock("@/lib/observability", () => ({
  reportError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

function pendingScan(localId: string, overrides: Partial<PendingScan> = {}): PendingScan {
  return {
    owner: "device:test-installation",
    localId,
    photoPath: `photos/${localId}.jpg`,
    cropPath: `crops/${localId}.jpg`,
    vector: [0.1],
    descriptors: new ArrayBuffer(4),
    keypoints: new ArrayBuffer(2),
    modelVersion: "v1",
    venueId: null,
    visitId: null,
    visitLocalId: null,
    capturedAt: 100,
    labelPhotoPath: null,
    qrUrl: null,
    status: "queued",
    attempts: 0,
    lastError: null,
    scanId: null,
    createdAt: 100,
    attemptModelVersion: overrides.modelVersion ?? "v1",
    ...overrides,
  };
}

function identified(localId: string, outcome: "confident" | "soft" | "miss" = "confident"): IdentifyResponse {
  return {
    scanId: `scan-${localId}` as Id<"scans">,
    localId,
    capturedAt: 100,
    status: "identified",
    outcome,
  } as IdentifyResponse;
}

function fakeDependencies(rows: PendingScan[]) {
  const store = new Map(rows.map((row) => [row.localId, row]));
  const deps = {
    listFlushable: jest.fn(async (modelVersion: string) =>
      [...store.values()]
        .filter(
          (row) => row.status === "queued" || (row.status === "failed" && row.attemptModelVersion !== modelVersion),
        )
        .sort((a, b) => a.capturedAt - b.capturedAt),
    ),
    listPendingLabels: jest.fn(async () =>
      [...store.values()].filter(
        (row) => row.status === "identified" && row.scanId && (row.labelPhotoPath || row.qrUrl) && row.attempts < 5,
      ),
    ),
    clearPendingLabel: jest.fn(async (localId: string) => {
      Object.assign(store.get(localId)!, {
        labelPhotoPath: null,
        qrUrl: null,
        attempts: 0,
        lastError: null,
      });
    }),
    recordLabelFailure: jest.fn(async (localId: string, error: string, { countAttempt }: { countAttempt: boolean }) => {
      const row = store.get(localId)!;
      row.attempts += countAttempt ? 1 : 0;
      row.lastError = error;
      return {
        status: row.attempts >= 5 ? ("failed" as const) : ("queued" as const),
        attempts: row.attempts,
      };
    }),
    markIdentifying: jest.fn(async (localId: string) => {
      store.get(localId)!.status = "identifying";
    }),
    recordResult: jest.fn(async (localId: string, response: IdentifyResponse) => {
      Object.assign(store.get(localId)!, {
        status: response.status === "unsupported_version" ? "failed" : "identified",
        scanId: response.scanId,
      });
    }),
    recordFailure: jest.fn(async (localId: string, error: string, { countAttempt }: { countAttempt: boolean }) => {
      const row = store.get(localId)!;
      row.attempts += countAttempt ? 1 : 0;
      row.lastError = error;
      row.status = row.attempts >= 5 ? "failed" : "queued";
      return { status: row.status, attempts: row.attempts };
    }),
    resetAttemptsForModel: jest.fn(async (localId: string, attemptModelVersion: string) => {
      Object.assign(store.get(localId)!, {
        attemptModelVersion,
        status: "queued",
        attempts: 0,
        lastError: null,
      });
    }),
    updateFeatures: jest.fn(async (localId: string, features: Partial<PendingScan>) => {
      Object.assign(store.get(localId)!, features, {
        attemptModelVersion: features.modelVersion,
        status: "queued",
        attempts: 0,
      });
    }),
    identify: jest.fn(async ({ localId }: { localId: string }) => identified(localId)),
    resolveVisitId: jest.fn(async (_localId: string, _venueId: Id<"museums">) => "remote-visit" as Id<"visits">),
    runLabelFlow: jest.fn(async () => {}),
    reembed: jest.fn(async () => ({
      vector: [9],
      descriptors: new ArrayBuffer(8),
      keypoints: new ArrayBuffer(8),
    })),
    isOnline: jest.fn(async (): Promise<boolean> => true),
    modelVersion: "v1",
  } satisfies FlushDependencies;
  return { deps, store };
}

beforeEach(() => {
  jest.mocked(reportError).mockClear();
  jest.useFakeTimers();
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it("identifies queued rows oldest first and records each result", async () => {
  const { deps, store } = fakeDependencies([
    pendingScan("later", { capturedAt: 200 }),
    pendingScan("earlier", { capturedAt: 100 }),
  ]);
  await createFlusher(deps).start();
  expect(deps.identify.mock.calls.map(([args]) => args.localId)).toEqual(["earlier", "later"]);
  expect(deps.identify).toHaveBeenCalledWith({
    localId: "earlier",
    vector: [0.1],
    descriptors: expect.any(ArrayBuffer),
    keypoints: expect.any(ArrayBuffer),
    modelVersion: "v1",
    venueId: undefined,
    visitId: undefined,
    capturedAt: 100,
  });
  expect(deps.markIdentifying.mock.invocationCallOrder[0]).toBeLessThan(deps.identify.mock.invocationCallOrder[0]);
  expect(store.get("earlier")).toMatchObject({
    status: "identified",
    scanId: "scan-earlier",
  });
  expect(store.get("later")).toMatchObject({
    status: "identified",
    scanId: "scan-later",
  });
  expect(deps.reembed).not.toHaveBeenCalled();
  expect(deps.runLabelFlow).not.toHaveBeenCalled();
});

it("does nothing while offline", async () => {
  const { deps } = fakeDependencies([pendingScan("a")]);
  deps.isOnline.mockResolvedValue(false);
  await createFlusher(deps).start();
  expect(deps.identify).not.toHaveBeenCalled();
  expect(deps.markIdentifying).not.toHaveBeenCalled();
  expect(reportError).not.toHaveBeenCalled();
});

it("reports a failed queued task while retaining its retry state", async () => {
  const { deps, store } = fakeDependencies([pendingScan("a")]);
  const error = new Error("Native model failed");
  deps.identify.mockRejectedValueOnce(error);
  const flusher = createFlusher(deps);
  await flusher.start();
  expect(reportError).toHaveBeenCalledWith(error, "queue.identify", {
    data: { attempts: 1, status: "queued" },
  });
  expect(store.get("a")).toMatchObject({ status: "queued", attempts: 1 });
  flusher.stop();
});

it("waits for the captured local visit before sending a queued scan", async () => {
  const venueId = "museum-1" as Id<"museums">;
  const { deps } = fakeDependencies([pendingScan("a", { venueId, visitLocalId: "original-visit" })]);
  let finish!: (id: Id<"visits">) => void;
  deps.resolveVisitId.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const flusher = createFlusher(deps);
  const running = flusher.start();
  for (let tick = 0; deps.resolveVisitId.mock.calls.length === 0 && tick < 20; tick++) {
    await Promise.resolve();
  }
  expect(deps.identify).not.toHaveBeenCalled();
  finish("original-remote-visit" as Id<"visits">);
  await running;
  expect(deps.resolveVisitId).toHaveBeenCalledWith("original-visit", venueId);
  expect(deps.identify).toHaveBeenCalledWith(expect.objectContaining({ venueId, visitId: "original-remote-visit" }));
  expect(deps.identify.mock.calls[0][0]).not.toHaveProperty("visitLocalId");
  flusher.stop();
});

it("retries a transient visit-sync failure without identifying without a visit or spending an attempt", async () => {
  const { deps, store } = fakeDependencies([
    pendingScan("a", {
      venueId: "museum-1" as Id<"museums">,
      visitLocalId: "local-visit",
    }),
  ]);
  deps.resolveVisitId.mockRejectedValueOnce(new ConvexError({ code: "device_not_registered" }));
  const flusher = createFlusher(deps);
  await flusher.start();
  expect(deps.identify).not.toHaveBeenCalled();
  expect(store.get("a")).toMatchObject({
    status: "queued",
    attempts: 0,
    visitLocalId: "local-visit",
  });
  await jest.advanceTimersByTimeAsync(2000);
  expect(deps.identify).toHaveBeenCalledWith(expect.objectContaining({ visitId: "remote-visit" }));
  flusher.stop();
});

it("does not identify after cleanup while its visit is syncing", async () => {
  const { deps, store } = fakeDependencies([
    pendingScan("a", {
      venueId: "museum-1" as Id<"museums">,
      visitLocalId: "local-visit",
    }),
  ]);
  let finish!: (id: Id<"visits">) => void;
  deps.resolveVisitId.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const flusher = createFlusher(deps);
  const running = flusher.start();
  for (let tick = 0; deps.resolveVisitId.mock.calls.length === 0 && tick < 20; tick++) {
    await Promise.resolve();
  }
  flusher.stop();
  finish("remote-visit" as Id<"visits">);
  await running;
  expect(deps.identify).not.toHaveBeenCalled();
  expect(store.get("a")).toMatchObject({ status: "queued", attempts: 0 });
});

it.each([
  ["confident", { labelPhotoPath: "labels/a.jpg" }, undefined],
  ["soft", { labelPhotoPath: "labels/a.jpg" }, { labelPhotoPath: "labels/a.jpg", qrUrl: undefined }],
  ["miss", { qrUrl: "https://museum.example/qr" }, { labelPhotoPath: undefined, qrUrl: "https://museum.example/qr" }],
  ["miss", {}, undefined],
] as const)("runs the label flow after a %s result only when a label was captured", async (outcome, row, expected) => {
  const { deps } = fakeDependencies([pendingScan("a", row)]);
  deps.identify.mockResolvedValue(identified("a", outcome));
  await createFlusher(deps).start();
  expect(deps.runLabelFlow.mock.calls).toEqual(expected ? [["scan-a", expected]] : []);
});

it("keeps the scan identified when the label flow fails", async () => {
  const { deps, store } = fakeDependencies([pendingScan("a", { qrUrl: "https://museum.example/qr" })]);
  deps.identify.mockResolvedValue(identified("a", "miss"));
  deps.runLabelFlow.mockRejectedValue(new Error("feature_off"));
  await createFlusher(deps).start();
  expect(store.get("a")).toMatchObject({
    status: "identified",
    attempts: 1,
    lastError: "feature_off",
  });
  expect(deps.recordFailure).not.toHaveBeenCalled();
});

it("re-embeds crops from an older model before sending them", async () => {
  const { deps } = fakeDependencies([
    pendingScan("old", { modelVersion: "v0", capturedAt: 1 }),
    pendingScan("new", { capturedAt: 2 }),
  ]);
  await createFlusher(deps).start();
  expect(deps.reembed).toHaveBeenCalledTimes(1);
  expect(deps.reembed).toHaveBeenCalledWith("crops/old.jpg");
  expect(deps.updateFeatures).toHaveBeenCalledWith("old", expect.objectContaining({ vector: [9], modelVersion: "v1" }));
  expect(deps.identify).toHaveBeenCalledWith(
    expect.objectContaining({
      localId: "old",
      vector: [9],
      modelVersion: "v1",
    }),
  );
  expect(deps.identify).toHaveBeenCalledWith(expect.objectContaining({ localId: "new", vector: [0.1] }));
});

it.each([
  new TypeError("Network request failed"),
  new Error("Connection lost while action was in flight"),
  new ConvexError({ code: "device_not_registered" }),
  new ConvexError({ code: "unauthenticated" }),
  new ConvexError({ code: "rate_limited" }),
])("stops on a transient failure without counting an attempt, then retries with backoff: %s", async (error) => {
  const { deps, store } = fakeDependencies([pendingScan("a", { capturedAt: 1 }), pendingScan("b", { capturedAt: 2 })]);
  deps.identify.mockRejectedValueOnce(error);
  await createFlusher(deps).start();
  expect(deps.identify).toHaveBeenCalledTimes(1);
  expect(deps.recordFailure).toHaveBeenCalledWith("a", expect.any(String), {
    countAttempt: false,
  });
  expect(store.get("a")).toMatchObject({ status: "queued", attempts: 0 });
  expect(store.get("b")).toMatchObject({ status: "queued" });
  expect(reportError).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1999);
  expect(deps.identify).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(deps.identify).toHaveBeenCalledTimes(3);
  expect(store.get("a")).toMatchObject({ status: "identified" });
  expect(store.get("b")).toMatchObject({ status: "identified" });
});

it("honors the server retry delay for the entire batch despite repeated flush triggers", async () => {
  const { deps, store } = fakeDependencies([pendingScan("a"), pendingScan("b")]);
  deps.identify.mockRejectedValueOnce(new ConvexError({ code: "rate_limited", retryAfter: 12_000 }));
  const flusher = createFlusher(deps);
  await flusher.start();
  for (let trigger = 0; trigger < 3; trigger++) await flusher.flush();
  await jest.advanceTimersByTimeAsync(11_999);
  expect(deps.identify).toHaveBeenCalledTimes(1);
  expect(store.get("a")).toMatchObject({ status: "queued", attempts: 0 });
  expect(store.get("b")).toMatchObject({ status: "queued", attempts: 0 });
  await jest.advanceTimersByTimeAsync(1);
  expect(deps.identify).toHaveBeenCalledTimes(3);
  expect([...store.values()].map((row) => row.status)).toEqual(["identified", "identified"]);
  expect(jest.getTimerCount()).toBe(0);
  flusher.stop();
});

it("counts other failures, keeps going, and gives up after five attempts", async () => {
  const { deps, store } = fakeDependencies([
    pendingScan("bad", { capturedAt: 1 }),
    pendingScan("good", { capturedAt: 2 }),
  ]);
  deps.identify.mockImplementation(async ({ localId }) => {
    if (localId === "bad") throw new ConvexError({ code: "bad_features" });
    return identified(localId);
  });
  const flusher = createFlusher(deps);
  await flusher.start();
  expect(store.get("good")).toMatchObject({ status: "identified" });
  expect(store.get("bad")).toMatchObject({
    status: "queued",
    attempts: 1,
    lastError: "bad_features",
  });
  for (const [attempt, delay] of [
    [2, 2000],
    [3, 4000],
    [4, 8000],
    [5, 16_000],
  ] as const) {
    await jest.advanceTimersByTimeAsync(delay - 1);
    expect(store.get("bad")!.attempts).toBe(attempt - 1);
    await jest.advanceTimersByTimeAsync(1);
    expect(store.get("bad")!.attempts).toBe(attempt);
  }
  expect(store.get("bad")).toMatchObject({ status: "failed", attempts: 5 });
  expect(jest.getTimerCount()).toBe(0);
  expect(deps.identify.mock.calls.filter(([args]) => args.localId === "good")).toHaveLength(1);
});

it("shares one run between concurrent callers and runs again for work that arrives meanwhile", async () => {
  const { deps, store } = fakeDependencies([pendingScan("a")]);
  let finish!: () => void;
  deps.identify.mockImplementationOnce(
    ({ localId }) =>
      new Promise((resolve) => {
        finish = () => resolve(identified(localId));
      }),
  );
  const flusher = createFlusher(deps);
  const first = flusher.start();
  const second = flusher.flush();
  expect(second).toBe(first);
  for (let tick = 0; deps.identify.mock.calls.length === 0 && tick < 20; tick++) {
    await Promise.resolve();
  }
  expect(deps.identify).toHaveBeenCalledTimes(1);
  store.set("b", pendingScan("b", { capturedAt: 200 }));
  const third = flusher.flush();
  expect(third).toBe(first);
  finish();
  await first;
  expect(deps.identify.mock.calls.map(([args]) => args.localId)).toEqual(["a", "b"]);
  expect(deps.listFlushable).toHaveBeenCalledTimes(2);
});

it("stops a scheduled retry and never rejects on a store failure", async () => {
  const { deps } = fakeDependencies([pendingScan("a")]);
  deps.identify.mockRejectedValueOnce(new ConvexError({ code: "bad_features" }));
  const flusher = createFlusher(deps);
  await flusher.start();
  expect(jest.getTimerCount()).toBe(1);
  flusher.stop();
  expect(jest.getTimerCount()).toBe(0);
  deps.listFlushable.mockRejectedValueOnce(new Error("database locked"));
  await expect(flusher.start()).resolves.toBeUndefined();
  expect(console.warn).toHaveBeenCalledWith("Queue flush failed", expect.any(Error));
});

it("honors retry deadlines across repeated triggers while processing new captures", async () => {
  const { deps, store } = fakeDependencies([pendingScan("bad")]);
  deps.identify.mockImplementation(async ({ localId }) => {
    if (localId === "bad") throw new ConvexError({ code: "bad_features" });
    return identified(localId);
  });
  const flusher = createFlusher(deps);
  await flusher.start();
  store.set("new", pendingScan("new", { capturedAt: 200 }));
  for (let trigger = 0; trigger < 5; trigger++) await flusher.flush();
  expect(store.get("bad")).toMatchObject({ status: "queued", attempts: 1 });
  expect(store.get("new")).toMatchObject({ status: "identified" });
  await jest.advanceTimersByTimeAsync(1999);
  expect(store.get("bad")!.attempts).toBe(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(store.get("bad")!.attempts).toBe(2);
});

it("does not use a newer row's shorter backoff to retry an older failure early", async () => {
  const { deps, store } = fakeDependencies([pendingScan("old", { attempts: 3 })]);
  deps.identify.mockRejectedValue(new ConvexError({ code: "bad_features" }));
  const flusher = createFlusher(deps);
  await flusher.start();
  store.set("new", pendingScan("new", { capturedAt: 200 }));
  await flusher.flush();
  await jest.advanceTimersByTimeAsync(2000);
  expect(store.get("old")).toMatchObject({ status: "queued", attempts: 4 });
  expect(store.get("new")).toMatchObject({ status: "queued", attempts: 2 });
  await jest.advanceTimersByTimeAsync(14_000);
  expect(store.get("old")).toMatchObject({ status: "failed", attempts: 5 });
});

it("ignores triggers before start and after stop, then resumes without overlapping the old request", async () => {
  const { deps, store } = fakeDependencies([pendingScan("a"), pendingScan("b")]);
  let finish!: () => void;
  deps.identify.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(identified("a"));
      }),
  );
  const flusher = createFlusher(deps);
  await flusher.flush();
  expect(deps.listFlushable).not.toHaveBeenCalled();
  const first = flusher.start();
  for (let tick = 0; deps.identify.mock.calls.length === 0 && tick < 20; tick++) {
    await Promise.resolve();
  }
  flusher.stop();
  await flusher.flush();
  const resumed = flusher.start();
  expect(resumed).toBe(first);
  expect(deps.identify).toHaveBeenCalledTimes(1);
  finish();
  await resumed;
  expect(deps.identify.mock.calls.map(([args]) => args.localId)).toEqual(["a", "b"]);
  expect([...store.values()].map((row) => row.status)).toEqual(["identifying", "identified"]);
});

it("leaves a crop queued if cleanup happens while it is being re-embedded", async () => {
  const { deps, store } = fakeDependencies([pendingScan("a", { modelVersion: "v0" })]);
  let finish!: () => void;
  deps.reembed.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () =>
          resolve({
            vector: [1],
            descriptors: new ArrayBuffer(4),
            keypoints: new ArrayBuffer(4),
          });
      }),
  );
  const flusher = createFlusher(deps);
  const running = flusher.start();
  for (let tick = 0; deps.reembed.mock.calls.length === 0 && tick < 20; tick++) {
    await Promise.resolve();
  }
  flusher.stop();
  finish();
  await running;
  expect(deps.updateFeatures).not.toHaveBeenCalled();
  expect(deps.identify).not.toHaveBeenCalled();
  expect(store.get("a")).toMatchObject({
    status: "queued",
    modelVersion: "v0",
  });
  await flusher.start();
  expect(store.get("a")).toMatchObject({
    status: "identified",
    modelVersion: "v1",
  });
});

it("releases a claimed row when cleanup happens before its request is sent", async () => {
  const { deps, store } = fakeDependencies([pendingScan("a")]);
  let finish!: () => void;
  deps.markIdentifying.mockImplementationOnce(async (localId) => {
    store.get(localId)!.status = "identifying";
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  const flusher = createFlusher(deps);
  const running = flusher.start();
  for (let tick = 0; deps.markIdentifying.mock.calls.length === 0 && tick < 20; tick++) {
    await Promise.resolve();
  }
  flusher.stop();
  finish();
  await running;
  expect(deps.identify).not.toHaveBeenCalled();
  expect(store.get("a")).toMatchObject({ status: "queued", attempts: 0 });
  await flusher.start();
  expect(store.get("a")!.status).toBe("identified");
});

it("honors a transport pause even when a concurrent caller requests another run", async () => {
  const { deps, store } = fakeDependencies([pendingScan("a"), pendingScan("b")]);
  deps.identify.mockRejectedValueOnce(new TypeError("Network request failed"));
  const flusher = createFlusher(deps);
  await Promise.all([flusher.start(), flusher.flush()]);
  expect(deps.identify).toHaveBeenCalledTimes(1);
  expect(store.get("a")).toMatchObject({ status: "queued", attempts: 0 });
  await jest.advanceTimersByTimeAsync(2000);
  expect(deps.identify).toHaveBeenCalledTimes(3);
});

it.each(["success", "failure"] as const)(
  "stops during an identify %s without sending another row or scheduling a retry",
  async (outcome) => {
    const { deps, store } = fakeDependencies([pendingScan("a"), pendingScan("b")]);
    let finish!: () => void;
    deps.identify.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finish = () =>
            outcome === "success" ? resolve(identified("a", "miss")) : reject(new TypeError("Network request failed"));
        }),
    );
    const flusher = createFlusher(deps);
    const running = flusher.start();
    for (let tick = 0; deps.identify.mock.calls.length === 0 && tick < 20; tick++) {
      await Promise.resolve();
    }
    flusher.stop();
    finish();
    await running;
    await jest.advanceTimersByTimeAsync(60_000);
    expect(deps.identify).toHaveBeenCalledTimes(1);
    expect(store.get("a")!.status).toBe("identifying");
    expect(store.get("b")!.status).toBe("queued");
    expect(jest.getTimerCount()).toBe(0);
  },
);

it("discards an account response immediately even before effect cleanup stops its worker", async () => {
  const { deps, store } = fakeDependencies([pendingScan("old-owner")]);
  let current = true;
  deps.identify.mockImplementation(async ({ localId }) => {
    current = false;
    return identified(localId);
  });
  const worker = createFlusher({ ...deps, isCurrent: () => current });
  await worker.start();
  expect(deps.recordResult).not.toHaveBeenCalled();
  expect(store.get("old-owner")?.status).toBe("identifying");
  worker.stop();
});

it("reads a label-first capture even when the image matcher returned a confident guess", async () => {
  const { deps } = fakeDependencies([pendingScan("label", { labelPhotoPath: "labels/label.jpg" })]);
  const flusher = createFlusher({ ...deps, isLabelCapture: () => true });
  await flusher.start();
  expect(deps.runLabelFlow).toHaveBeenCalledWith("scan-label", {
    labelPhotoPath: "labels/label.jpg",
    qrUrl: undefined,
  });
  expect(deps.runLabelFlow.mock.invocationCallOrder[0]).toBeLessThan(
    deps.clearPendingLabel.mock.invocationCallOrder[0],
  );
  flusher.stop();
});
