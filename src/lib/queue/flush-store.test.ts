import { ConvexError } from "convex/values";

import type { Id } from "../../../convex/_generated/dataModel";
import * as pending from "@/db/repos/pending-scans";
import {
  getVisit,
  listUnsyncedVisits,
  markVisitsSynced,
  patchVisit,
  upsertVisit,
} from "@/db/repos/visits";
import type { NewPendingScan } from "@/db/schema";
import { resolveScanVisit } from "@/lib/venue/visit-sync";
import { createFlusher, type FlushDependencies } from "./flush";

jest.mock("@/db/client", () => ({ db: jest.requireActual("@/db/test-db").createTestDatabase() }));
const mockFlushJournal = jest.fn();
jest.mock("@/lib/account/collection-sync", () => ({ flushJournal: () => mockFlushJournal() }));

function capture(localId: string, modelVersion = "v1"): NewPendingScan {
  return {
    localId,
    modelVersion,
    attemptModelVersion: modelVersion,
    photoPath: `photos/${localId}.jpg`,
    cropPath: `crops/${localId}.jpg`,
    vector: [1],
    descriptors: new ArrayBuffer(4),
    keypoints: new ArrayBuffer(4),
    capturedAt: Number(localId) || 1,
    createdAt: Date.now(),
  };
}

function dependencies(modelVersion = "v1") {
  return {
    modelVersion,
    listFlushable: pending.listFlushable,
    listPendingLabels: pending.listPendingLabels,
    clearPendingLabel: pending.clearPendingLabel,
    recordLabelFailure: pending.recordLabelFailure,
    markIdentifying: pending.markIdentifying,
    recordFailure: pending.recordAttemptFailure,
    resetAttemptsForModel: pending.resetAttemptsForModel,
    updateFeatures: pending.updateFeatures,
    resolveVisitId: resolveScanVisit,
    recordResult: (localId, response) => pending.markIdentified(localId, response.scanId),
    isOnline: async (): Promise<boolean> => true,
    runLabelFlow: async () => {},
    reembed: jest.fn(async () => ({
      vector: [2],
      descriptors: new ArrayBuffer(4),
      keypoints: new ArrayBuffer(4),
    })),
    identify: jest.fn(async ({ localId }) => ({
      scanId: `scan-${localId}` as Id<"scans">,
      localId,
      capturedAt: 1,
      status: "identified" as const,
    })),
  } satisfies FlushDependencies;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockFlushJournal.mockImplementation(async () => {
    for (const visit of await listUnsyncedVisits())
      await markVisitsSynced([
        {
          localId: visit.localId,
          revision: visit.revision,
          visitId: `remote-${visit.localId}` as Id<"visits">,
          updatedAt: Date.now(),
          updatedBy: "device" as Id<"devices">,
        },
      ]);
  });
});
afterEach(async () => {
  for (const row of await pending.pendingScansQuery()) await pending.deletePendingScan(row.localId);
  jest.useRealTimers();
});

it("drains a healthy offline batch through the device quota without spending capture attempts", async () => {
  for (let i = 0; i < 100; i++) await pending.enqueuePendingScan(capture(String(i)));
  const deps = dependencies();
  // Match identify's configured token bucket: capacity 20, refilling 60 tokens per minute.
  let tokens = 20;
  let lastRefill = Date.now();
  deps.identify.mockImplementation(async ({ localId }) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const now = Date.now();
    tokens = Math.min(20, tokens + (now - lastRefill) / 1000);
    lastRefill = now;
    if (tokens < 1)
      throw new ConvexError({ code: "rate_limited", retryAfter: (1 - tokens) * 1000 });
    tokens--;
    return {
      scanId: `scan-${localId}` as Id<"scans">,
      localId,
      capturedAt: 1,
      status: "identified",
    };
  });
  const flusher = createFlusher(deps);
  const started = flusher.start();
  await jest.advanceTimersByTimeAsync(180_000);
  await started;
  flusher.stop();
  expect(await pending.pendingScansQuery()).toHaveLength(100);
  expect(await pending.listFlushable("v1")).toEqual([]);
  for (let i = 0; i < 100; i++) {
    expect(await pending.getPendingScan(String(i))).toMatchObject({
      status: "identified",
      attempts: 0,
    });
    await pending.deletePendingScan(String(i));
  }
});

it("keeps exhausted re-embeds paused across triggers and restarts until a manual retry", async () => {
  await pending.enqueuePendingScan(capture("old", "v0"));
  const deps = dependencies();
  deps.reembed.mockRejectedValue(new Error("bad_input"));
  const flusher = createFlusher(deps);
  await flusher.start();
  await jest.advanceTimersByTimeAsync(30_000);
  expect(await pending.getPendingScan("old")).toMatchObject({
    status: "failed",
    attempts: 5,
    modelVersion: "v0",
  });
  for (let trigger = 0; trigger < 3; trigger++) await flusher.flush();
  flusher.stop();
  await pending.requeueInterrupted();
  const restarted = createFlusher(deps);
  await restarted.start();
  expect(deps.reembed).toHaveBeenCalledTimes(5);
  expect(await pending.listFlushable("v1")).toEqual([]);
  expect(jest.getTimerCount()).toBe(0);
  await pending.retryPendingScan("old");
  await restarted.flush();
  expect(deps.reembed).toHaveBeenCalledTimes(6);
  expect(await pending.getPendingScan("old")).toMatchObject({ status: "queued", attempts: 1 });
  restarted.stop();
});

it("gives an exhausted crop a fresh retry budget on each model update", async () => {
  await pending.enqueuePendingScan({ ...capture("old", "v0"), status: "failed", attempts: 5 });
  for (const modelVersion of ["v1", "v2"]) {
    const deps = dependencies(modelVersion);
    deps.reembed.mockRejectedValue(new Error("bad_input"));
    const flusher = createFlusher(deps);
    await flusher.start();
    expect(await pending.getPendingScan("old")).toMatchObject({
      status: "queued",
      attempts: 1,
      modelVersion: "v0",
    });
    await jest.advanceTimersByTimeAsync(30_000);
    expect(deps.reembed).toHaveBeenCalledTimes(5);
    expect(await pending.getPendingScan("old")).toMatchObject({ status: "failed", attempts: 5 });
    expect(await pending.listFlushable(modelVersion)).toEqual([]);
    flusher.stop();
  }
});

it("retains the captured visit across an offline restart and a subsequent visit to the same museum", async () => {
  const venueId = "museum-1" as Id<"museums">;
  await upsertVisit({
    visitedOn: "1970-01-01",
    timeZone: "UTC",
    localId: "9d3fe99c-67ec-59c6-b837-043ec16326fd",
    venueId,
    venueName: "Museum",
    startedAt: 10,
  });
  await pending.enqueuePendingScan({
    ...capture("visit-capture"),
    venueId,
    visitLocalId: "9d3fe99c-67ec-59c6-b837-043ec16326fd",
  });
  const offline = dependencies();
  offline.isOnline = async () => false;
  const first = createFlusher(offline);
  await first.start();
  first.stop();
  expect(offline.identify).not.toHaveBeenCalled();
  await patchVisit("9d3fe99c-67ec-59c6-b837-043ec16326fd", { endedAt: 20 });
  await upsertVisit({
    visitedOn: "1970-01-01",
    timeZone: "UTC",
    localId: "496f105e-6e44-5988-a91f-0f2e236897cd",
    venueId,
    venueName: "Museum",
    startedAt: 30,
  });

  const reconnected = dependencies();
  const restarted = createFlusher(reconnected);
  await restarted.start();
  restarted.stop();
  expect(reconnected.identify).toHaveBeenCalledWith(
    expect.objectContaining({ venueId, visitId: "remote-9d3fe99c-67ec-59c6-b837-043ec16326fd" }),
  );
  expect(await getVisit("9d3fe99c-67ec-59c6-b837-043ec16326fd")).toMatchObject({
    startedAt: 10,
    endedAt: 20,
    remoteVisitId: "remote-9d3fe99c-67ec-59c6-b837-043ec16326fd",
  });
  expect(await getVisit("496f105e-6e44-5988-a91f-0f2e236897cd")).toMatchObject({
    startedAt: 30,
    endedAt: null,
  });
  expect(await pending.getPendingScan("visit-capture")).toMatchObject({
    status: "identified",
    visitLocalId: "9d3fe99c-67ec-59c6-b837-043ec16326fd",
    attempts: 0,
  });
  await pending.deletePendingScan("visit-capture");
});

it("reads a label attached offline after identification without identifying again", async () => {
  await pending.enqueuePendingScan({
    ...capture("label-after-identify"),
    status: "identified",
    scanId: "scan-existing" as Id<"scans">,
  });
  await pending.setLabelPhoto("label-after-identify", "labels/offline.jpg");
  const deps = { ...dependencies(), runLabelFlow: jest.fn(async () => {}) };
  const flusher = createFlusher(deps);
  await flusher.start();
  await flusher.flush();
  flusher.stop();
  expect(deps.identify).not.toHaveBeenCalled();
  expect(deps.runLabelFlow).toHaveBeenCalledTimes(1);
  expect(deps.runLabelFlow).toHaveBeenCalledWith("scan-existing", {
    labelPhotoPath: "labels/offline.jpg",
    qrUrl: undefined,
  });
  expect(await pending.getPendingScan("label-after-identify")).toMatchObject({
    status: "identified",
    labelPhotoPath: null,
  });
  await pending.deletePendingScan("label-after-identify");
});

it("retries an interrupted label after restart without repeating identification", async () => {
  await pending.enqueuePendingScan({
    ...capture("label-retry"),
    status: "identified",
    scanId: "scan-retry" as Id<"scans">,
    labelPhotoPath: "labels/retry.jpg",
  });
  const first = {
    ...dependencies(),
    runLabelFlow: jest.fn(async () => {
      throw new Error("Network request failed");
    }),
  };
  const flusher = createFlusher(first);
  await flusher.start();
  flusher.stop();
  expect(await pending.getPendingScan("label-retry")).toMatchObject({
    status: "identified",
    labelPhotoPath: "labels/retry.jpg",
    attempts: 0,
  });
  const reconnected = { ...dependencies(), runLabelFlow: jest.fn(async () => {}) };
  const restarted = createFlusher(reconnected);
  await restarted.start();
  restarted.stop();
  expect(reconnected.runLabelFlow).toHaveBeenCalledTimes(1);
  expect(reconnected.identify).not.toHaveBeenCalled();
  expect(await pending.getPendingScan("label-retry")).toMatchObject({
    status: "identified",
    labelPhotoPath: null,
    lastError: null,
  });
  await pending.deletePendingScan("label-retry");
});

it("processes a label attached while its scan is being identified", async () => {
  await pending.enqueuePendingScan(capture("label-during-identify"));
  const deps = { ...dependencies(), runLabelFlow: jest.fn(async () => {}) };
  deps.identify.mockImplementation(async () => {
    await pending.setQrUrl("label-during-identify", "https://museum.example/late");
    return {
      scanId: "scan-late" as Id<"scans">,
      localId: "label-during-identify",
      capturedAt: 1,
      status: "identified",
      outcome: "miss",
    };
  });
  const flusher = createFlusher(deps);
  await flusher.start();
  flusher.stop();
  expect(deps.runLabelFlow).toHaveBeenCalledWith("scan-late", {
    labelPhotoPath: undefined,
    qrUrl: "https://museum.example/late",
  });
  await pending.deletePendingScan("label-during-identify");
});

it("bounds persistent label errors and retries them only after an explicit retry", async () => {
  await pending.enqueuePendingScan({
    ...capture("label-failed"),
    status: "identified",
    scanId: "scan-failed" as Id<"scans">,
    qrUrl: "https://museum.example/label",
  });
  const deps = {
    ...dependencies(),
    runLabelFlow: jest.fn(async (): Promise<void> => {
      throw new Error("model_error");
    }),
  };
  const flusher = createFlusher(deps);
  await flusher.start();
  await jest.advanceTimersByTimeAsync(60_000);
  expect(deps.runLabelFlow).toHaveBeenCalledTimes(pending.MAX_LABEL_ATTEMPTS);
  expect(await pending.getPendingScan("label-failed")).toMatchObject({
    status: "identified",
    attempts: pending.MAX_LABEL_ATTEMPTS,
  });
  await flusher.flush();
  expect(deps.runLabelFlow).toHaveBeenCalledTimes(pending.MAX_LABEL_ATTEMPTS);
  await pending.retryPendingLabel("label-failed");
  deps.runLabelFlow.mockResolvedValue(undefined);
  await flusher.flush();
  flusher.stop();
  expect(await pending.getPendingScan("label-failed")).toMatchObject({
    status: "identified",
    qrUrl: null,
  });
  expect(deps.identify).not.toHaveBeenCalled();
  await pending.deletePendingScan("label-failed");
});

it("identifies new paintings while a label quota is paused and resumes labels at their own deadline", async () => {
  const localId = "label-quota";
  await pending.enqueuePendingScan({
    ...capture(localId),
    status: "identified",
    scanId: "scan-quota" as Id<"scans">,
    qrUrl: "https://museum.example/label",
  });
  const deps = { ...dependencies(), runLabelFlow: jest.fn(async (): Promise<void> => {}) };
  deps.runLabelFlow.mockRejectedValueOnce(
    new ConvexError({ code: "rate_limited", retryAfter: 3_600_000 }),
  );
  const flusher = createFlusher(deps);
  try {
    await flusher.start();
    await pending.enqueuePendingScan(capture("new-painting"));
    for (let trigger = 0; trigger < 3; trigger++) await flusher.flush();
    expect(await pending.getPendingScan("new-painting")).toMatchObject({
      status: "identified",
      attempts: 0,
    });
    expect(await pending.getPendingScan(localId)).toMatchObject({
      status: "identified",
      attempts: 0,
      qrUrl: "https://museum.example/label",
    });
    expect(deps.runLabelFlow).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(3_599_999);
    expect(deps.runLabelFlow).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(deps.runLabelFlow).toHaveBeenCalledTimes(2);
    expect(await pending.getPendingScan(localId)).toMatchObject({
      status: "identified",
      qrUrl: null,
      lastError: null,
    });
    expect(deps.identify).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    flusher.stop();
    await pending.deletePendingScan(localId);
    await pending.deletePendingScan("new-painting");
  }
});

it("processes an identified scan’s label while the identification quota is paused", async () => {
  await pending.enqueuePendingScan(capture("identify-quota"));
  await pending.enqueuePendingScan({
    ...capture("ready-label"),
    status: "identified",
    scanId: "scan-ready" as Id<"scans">,
    labelPhotoPath: "labels/ready.jpg",
  });
  const deps = { ...dependencies(), runLabelFlow: jest.fn(async (): Promise<void> => {}) };
  deps.identify.mockRejectedValueOnce(
    new ConvexError({ code: "rate_limited", retryAfter: 12_000 }),
  );
  const flusher = createFlusher(deps);
  try {
    await flusher.start();
    expect(await pending.getPendingScan("ready-label")).toMatchObject({
      status: "identified",
      labelPhotoPath: null,
    });
    for (let trigger = 0; trigger < 3; trigger++) await flusher.flush();
    await jest.advanceTimersByTimeAsync(11_999);
    expect(deps.identify).toHaveBeenCalledTimes(1);
    expect(await pending.getPendingScan("identify-quota")).toMatchObject({
      status: "queued",
      attempts: 0,
    });
    await jest.advanceTimersByTimeAsync(1);
    expect(await pending.getPendingScan("identify-quota")).toMatchObject({
      status: "identified",
      attempts: 0,
    });
    expect(deps.runLabelFlow).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    flusher.stop();
    await pending.deletePendingScan("identify-quota");
    await pending.deletePendingScan("ready-label");
  }
});
