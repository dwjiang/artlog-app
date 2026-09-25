import { ConvexError } from "convex/values";
import { AppState } from "react-native";

import { switchOwner } from "@/lib/account/owner-store";
import type { CapturePayload, IdentifyResponse } from "@/lib/capture/stages";
import { LabelFlowError } from "@/lib/label/flow";
import model from "@/shared/model/model-version.json";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { FlushDependencies } from "./flush";

const mockRepo = {
  enqueuePendingScan: jest.fn(),
  markIdentified: jest.fn(),
  markFailed: jest.fn(),
  recordAttemptFailure: jest.fn(),
  retryPendingScan: jest.fn(),
  requeueInterrupted: jest.fn(),
  listFlushable: jest.fn(),
  markIdentifying: jest.fn(),
  updateFeatures: jest.fn(),
  resetAttemptsForModel: jest.fn(),
  listPendingLabels: jest.fn(),
  clearPendingLabel: jest.fn(),
  recordLabelFailure: jest.fn(),
  retryPendingLabel: jest.fn(),
  getPendingScan: jest.fn(),
};
const mockPersist = jest.fn();
const mockAction = jest.fn();
const mockNetworkState = jest.fn();
const mockNetworkListener = jest.fn();
const mockExtract = jest.fn();
const mockResolveVisit = jest.fn();
const mockFlush = jest.fn();
const mockRunLabelFlow = jest.fn();
const mockStart = jest.fn();
const mockStop = jest.fn();
let mockDocumentsUri = "file:///documents";
let flushDeps: FlushDependencies;
let stopWorker: (() => void) | undefined;
async function startWorker() {
  stopWorker = startQueueFlusher();
  await Promise.resolve();
  await Promise.resolve();
  jest.clearAllMocks();
}

jest.mock("@/db/repos/pending-scans", () => mockRepo);
jest.mock("@/lib/venue/visit-sync", () => ({
  resolveScanVisit: (...args: unknown[]) => mockResolveVisit(...args),
}));
jest.mock("@/lib/files/photos", () => ({
  ...jest.requireActual("@/lib/files/photos"),
  persistCapture: (...args: unknown[]) => mockPersist(...args),
  captureFileUri: (path: string) => `${mockDocumentsUri}/${path}`,
}));
jest.mock("@/lib/convex-client", () => ({
  convex: { action: (...args: unknown[]) => mockAction(...args) },
}));
jest.mock("@/lib/embed/embedder", () => ({ embedder: { name: "embedder" } }));
jest.mock("@/lib/label/crop", () => ({ removeFile: jest.fn() }));
jest.mock("@/lib/label/label-deps", () => ({
  runLabelFlowForScan: (...args: unknown[]) => mockRunLabelFlow(...args),
}));
jest.mock("@/lib/capture/features", () => ({
  roundVector: jest.requireActual("@/lib/capture/features").roundVector,
  orb: { name: "orb" },
  extractFeatures: (...args: unknown[]) => mockExtract(...args),
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => "cap-1" }));
jest.mock("expo-network", () => ({
  getNetworkStateAsync: () => mockNetworkState(),
  addNetworkStateListener: (listener: unknown) => mockNetworkListener(listener),
}));
jest.mock("./flush", () => ({
  createFlusher: (deps: FlushDependencies) => {
    flushDeps = deps;
    return {
      start: () => {
        mockStart();
        return mockFlush();
      },
      flush: mockFlush,
      stop: mockStop,
    };
  },
}));

// Loaded after the mocks above exist: the factories hand back objects declared in this file.
const { captureStore, discardPendingLabel, flushQueue, retryPendingScan, startQueueFlusher } =
  jest.requireActual<typeof import("./queue")>("./queue");
const { runCapture } = jest.requireActual<typeof import("@/lib/capture/pipeline")>("@/lib/capture/pipeline");

const scanId = "scan-1" as Id<"scans">;
const payload: CapturePayload = {
  owner: "device:test-installation",
  scope: "test-scope",
  contentBounds: { x: 0, y: 64, width: 512, height: 384 },
  localId: "cap-1",
  vector: [0.5],
  descriptors: new ArrayBuffer(4),
  keypoints: new ArrayBuffer(2),
  modelVersion: model.modelVersion,
  venueId: "museum-1" as Id<"museums">,
  visitLocalId: "local-visit",
  capturedAt: 123,
  photoUri: "file:///tmp/photo.jpg",
  cropUri: "file:///caches/crops/x.jpg",
  cropCorners: [
    [0.1, 0.2],
    [0.9, 0.2],
    [0.9, 0.8],
    [0.1, 0.8],
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  for (const fn of Object.values(mockRepo)) fn.mockResolvedValue(undefined);
  mockDocumentsUri = "file:///documents";
  mockPersist.mockResolvedValue({
    photoPath: "photos/cap-1.jpg",
    cropPath: "crops/cap-1.jpg",
  });
  mockFlush.mockResolvedValue(undefined);
  mockNetworkListener.mockReturnValue({ remove: jest.fn() });
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  stopWorker?.();
  stopWorker = undefined;
  jest.restoreAllMocks();
});

it("persists both files before inserting the row with its crop corners and the requested status", async () => {
  await captureStore.enqueue(payload, "identifying");
  expect(mockPersist).toHaveBeenCalledWith({
    localId: "cap-1",
    photoUri: "file:///tmp/photo.jpg",
    cropUri: "file:///caches/crops/x.jpg",
    contentBounds: payload.contentBounds,
  });
  expect(mockRepo.enqueuePendingScan).toHaveBeenCalledWith(
    {
      localId: "cap-1",
      photoPath: "photos/cap-1.jpg",
      cropPath: "crops/cap-1.jpg",
      cropCorners: payload.cropCorners,
      vector: [0.5],
      descriptors: payload.descriptors,
      keypoints: payload.keypoints,
      modelVersion: model.modelVersion,
      attemptModelVersion: model.modelVersion,
      venueId: "museum-1",
      visitId: undefined,
      visitLocalId: "local-visit",
      capturedAt: 123,
      status: "identifying",
      createdAt: expect.any(Number),
    },
    payload.owner,
  );
  expect(mockPersist.mock.invocationCallOrder[0]).toBeLessThan(mockRepo.enqueuePendingScan.mock.invocationCallOrder[0]);
  expect(mockFlush).not.toHaveBeenCalled();
});

it("records identified scans, keeps unsupported versions as failed, and requeues without counting", async () => {
  await captureStore.recordResult("cap-1", {
    scanId,
    status: "identified",
  } as IdentifyResponse);
  expect(mockRepo.markIdentified).toHaveBeenCalledWith("cap-1", scanId, payload.owner);
  await captureStore.recordResult("cap-1", {
    scanId,
    status: "unsupported_version",
    error: "Update the app to identify.",
  } as IdentifyResponse);
  expect(mockRepo.markFailed).toHaveBeenCalledWith("cap-1", "Update the app to identify.", scanId, payload.owner);
  await captureStore.recordResult("cap-1", {
    scanId,
    status: "unsupported_version",
  } as IdentifyResponse);
  expect(mockRepo.markFailed).toHaveBeenLastCalledWith("cap-1", "Update the app to identify.", scanId, payload.owner);
  await captureStore.requeue("cap-1", "Network request failed");
  expect(mockRepo.recordAttemptFailure).toHaveBeenCalledWith(
    "cap-1",
    "Network request failed",
    { countAttempt: false },
    payload.owner,
  );
});

it.each(["device_not_registered", "rate_limited"])(
  "wakes the worker after requeueing an inline %s failure",
  async (error) => {
    await startWorker();
    const failure = new ConvexError({ code: error });
    await expect(
      runCapture(
        {
          photoUri: payload.photoUri,
          capturedAt: 1,
          quad: null,
          source: "camera",
        },
        {
          warper: {
            warpAndLetterbox: async () => ({
              cropUri: payload.cropUri,
              corners: [
                [0.1, 0.2],
                [0.9, 0.2],
                [0.9, 0.8],
                [0.1, 0.8],
              ],
              photoSize: { width: 1200, height: 1600 },
              contentBounds: { x: 0, y: 64, width: 512, height: 384 },
              cropSize: 512,
            }),
          },
          triage: { check: async () => ({ ok: true }) },
          embedder: {
            modelVersion: "v1",
            embed: async () => new Float32Array([1]),
          },
          orb: {
            extract: async () => ({
              descriptors: payload.descriptors,
              keypoints: payload.keypoints,
              count: 1,
            }),
          },
          store: captureStore,
          identify: async () => {
            throw failure;
          },
          isOnline: () => true,
        },
        { modelVersion: "v1", inputSize: 512 },
      ),
    ).rejects.toBe(failure);
    expect(mockRepo.recordAttemptFailure).toHaveBeenCalledWith("cap-1", error, { countAttempt: false }, payload.owner);
    expect(mockFlush).toHaveBeenCalledTimes(1);
    expect(mockRepo.recordAttemptFailure.mock.invocationCallOrder[0]).toBeLessThan(
      mockFlush.mock.invocationCallOrder[0],
    );
  },
);

it("wakes the worker once an offline capture is stored, without relying on a mounted screen", async () => {
  await startWorker();
  await captureStore.enqueue(payload, "queued");
  expect(mockFlush).toHaveBeenCalledTimes(1);
  expect(mockRepo.enqueuePendingScan.mock.invocationCallOrder[0]).toBeLessThan(mockFlush.mock.invocationCallOrder[0]);
});

it("flushes at start, on reconnect and on foreground, and stops cleanly", async () => {
  const appStateListener = jest.fn();
  const removeAppState = jest.fn();
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    appStateListener.mockImplementation(listener);
    return { remove: removeAppState };
  });
  const stop = startQueueFlusher();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(mockRepo.requeueInterrupted).toHaveBeenCalledTimes(1);
  expect(mockFlush).toHaveBeenCalledTimes(1);
  const networkListener = mockNetworkListener.mock.calls[0][0] as (state: {
    isInternetReachable?: boolean;
    isConnected?: boolean;
  }) => void;
  networkListener({ isInternetReachable: false, isConnected: false });
  expect(mockFlush).toHaveBeenCalledTimes(1);
  networkListener({ isInternetReachable: true, isConnected: true });
  networkListener({ isConnected: true });
  expect(mockFlush).toHaveBeenCalledTimes(3);
  appStateListener("background");
  expect(mockFlush).toHaveBeenCalledTimes(3);
  appStateListener("active");
  expect(mockFlush).toHaveBeenCalledTimes(4);
  stop();
  expect(mockNetworkListener.mock.results[0].value.remove).toHaveBeenCalled();
  expect(removeAppState).toHaveBeenCalled();
  expect(mockStop).toHaveBeenCalled();
  const stopAgain = startQueueFlusher();
  await Promise.resolve();
  await Promise.resolve();
  expect(mockRepo.requeueInterrupted).toHaveBeenCalledTimes(2);
  expect(mockStart).toHaveBeenCalledTimes(2);
  stopAgain();
});

it("does not start from a pending initialization callback after cleanup", async () => {
  const stop = startQueueFlusher();
  stop();
  await Promise.resolve();
  await Promise.resolve();
  expect(mockStart).not.toHaveBeenCalled();
  expect(mockFlush).not.toHaveBeenCalled();
});

it("resets a failed row and flushes on manual retry", async () => {
  await startWorker();
  await retryPendingScan("cap-1");
  expect(mockRepo.retryPendingScan).toHaveBeenCalledWith("cap-1");
  expect(mockFlush).toHaveBeenCalledTimes(1);
  await flushQueue();
  expect(mockFlush).toHaveBeenCalledTimes(2);
});

it("wires identify, reachability and re-embedding into the flusher", async () => {
  await startWorker();
  mockResolveVisit.mockResolvedValue("remote-visit");
  expect(await flushDeps.resolveVisitId("local-visit", "museum-1" as Id<"museums">)).toBe("remote-visit");
  expect(mockResolveVisit).toHaveBeenCalledWith("local-visit", "museum-1");
  mockAction.mockResolvedValue("response");
  const args = {
    localId: "cap-1",
    vector: [1],
    descriptors: new ArrayBuffer(1),
    keypoints: new ArrayBuffer(1),
    modelVersion: "v",
    capturedAt: 1,
  };
  expect(await flushDeps.identify(args)).toBe("response");
  expect(mockAction).toHaveBeenCalledWith(api.identify.identify, {
    ...args,
    scope: "test-scope",
  });
  mockNetworkState.mockResolvedValueOnce({ isInternetReachable: false });
  expect(await flushDeps.isOnline()).toBe(false);
  mockNetworkState.mockResolvedValueOnce({ isInternetReachable: undefined });
  expect(await flushDeps.isOnline()).toBe(true);
  mockExtract.mockResolvedValue("features");
  mockDocumentsUri = "file:///new-container/documents";
  expect(await flushDeps.reembed("crops/a.jpg")).toBe("features");
  expect(mockExtract).toHaveBeenCalledWith("file:///new-container/documents/crops/a.jpg", {
    embedder: { name: "embedder" },
    orb: { name: "orb" },
  });
  expect(flushDeps.modelVersion).toBe(model.modelVersion);
  await flushDeps.recordFailure("cap-1", "failed", { countAttempt: false });
  expect(mockRepo.recordAttemptFailure).toHaveBeenCalledWith("cap-1", "failed", { countAttempt: false }, payload.owner);
  mockRunLabelFlow.mockResolvedValue({ stage: "verified" });
  await expect(
    flushDeps.runLabelFlow(scanId, {
      labelPhotoPath: "labels/a.jpg",
      qrUrl: "https://museum.example/qr",
    }),
  ).resolves.toBeUndefined();
  expect(mockRunLabelFlow).toHaveBeenCalledWith(scanId, {
    labelPhotoUri: "file:///new-container/documents/labels/a.jpg",
    qrUrl: "https://museum.example/qr",
  });
  await expect(flushDeps.runLabelFlow(scanId, { qrUrl: "https://museum.example/qr" })).resolves.toBeUndefined();
  expect(mockRunLabelFlow).toHaveBeenLastCalledWith(scanId, {
    labelPhotoUri: undefined,
    qrUrl: "https://museum.example/qr",
  });
});

it("preserves transport errors from the label reader for queue backoff", async () => {
  await startWorker();
  const cause = new Error("Network request failed");
  mockRunLabelFlow.mockRejectedValue(new LabelFlowError("network", { cause }));
  await expect(flushDeps.runLabelFlow(scanId, { qrUrl: "https://museum.example/qr" })).rejects.toBe(cause);
});

it("discards only the pending label and its file when the user chooses a retake", async () => {
  mockRepo.getPendingScan.mockResolvedValue({
    labelPhotoPath: "labels/failed.jpg",
    qrUrl: null,
  });
  await discardPendingLabel("cap-1");
  expect(mockRepo.clearPendingLabel).toHaveBeenCalledWith(
    "cap-1",
    { labelPhotoPath: "labels/failed.jpg", qrUrl: undefined },
    payload.owner,
  );
  const { removeFile } = jest.requireMock("@/lib/label/crop");
  expect(removeFile).toHaveBeenCalledWith("file:///documents/labels/failed.jpg");
  expect(mockRepo.markIdentified).not.toHaveBeenCalled();
  expect(mockRepo.retryPendingScan).not.toHaveBeenCalled();
  expect(mockFlush).not.toHaveBeenCalled();
});

it("does not enqueue into the old owner after file persistence crosses an account switch", async () => {
  mockPersist.mockImplementationOnce(async () => {
    switchOwner("account:other", "other-scope");
    return { photoPath: "photos/new.jpg", cropPath: "crops/new.jpg" };
  });
  try {
    await expect(captureStore.enqueue(payload, "queued")).rejects.toThrow("Journal owner changed");
    expect(mockRepo.enqueuePendingScan).not.toHaveBeenCalled();
    expect(jest.mocked(jest.requireMock("@/lib/label/crop").removeFile).mock.calls).toEqual([
      ["file:///documents/photos/new.jpg"],
      ["file:///documents/crops/new.jpg"],
      ["file:///documents/crops/new.preview.jpg"],
    ]);
  } finally {
    switchOwner(payload.owner, payload.scope);
  }
});
