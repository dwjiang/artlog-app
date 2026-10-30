import { ConvexError } from "convex/values";

import { anonymousOwner, switchOwner } from "@/lib/account/owner-store";
import { failureDetails } from "@/lib/failure-step";

import { runCapture } from "./pipeline";
import type {
  CaptureDependencies,
  CaptureInput,
  CapturePayload,
  IdentifyResponse,
  PreparedPainting,
  VenueContext,
} from "./stages";

jest.mock("expo-crypto", () => ({ randomUUID: jest.fn(() => "capture-uuid") }));
const mockRemove = jest.fn();
jest.mock("@/lib/files/remove-file", () => ({ removeFileIfExists: (uri: string) => mockRemove(uri) }));

const input: CaptureInput = {
  photoUri: "file:///photo.jpg",
  quad: null,
  source: "camera",
  turns: 1,
  view: { width: 402, height: 874 },
  capturedAt: 1234,
};
const painting: PreparedPainting = {
  cropUri: "file:///crop.jpg",
  corners: [
    [0.1, 0.2],
    [0.9, 0.2],
    [0.9, 0.8],
    [0.1, 0.8],
  ],
  photoSize: { width: 1200, height: 1600 },
  contentBounds: { x: 0, y: 64, width: 512, height: 384 },
  cropSize: 512,
};
const options = { inputSize: 512, modelVersion: "test-model" };
const response = {
  scanId: "scan-id",
  localId: "capture-uuid",
  capturedAt: 1234,
  status: "identified",
} as IdentifyResponse;

function dependencies() {
  return {
    warper: {
      warpCandidates: jest.fn(async (): Promise<PreparedPainting[]> => [painting]),
    },
    triage: { check: jest.fn(async () => ({ ok: true as const })) },
    embedder: {
      modelVersion: "test-model",
      embed: jest.fn(async () => new Float32Array([0.1234567, -0.9876543])),
    },
    orb: {
      extract: jest.fn(async () => ({
        descriptors: new ArrayBuffer(32),
        keypoints: new ArrayBuffer(16),
        count: 1,
      })),
    },
    identify: jest.fn(async (_payload: CapturePayload) => response),
    rankCrops: jest.fn(async (_vectors: number[][], _venueId: VenueContext["venueId"]) => 0),
    isOnline: jest.fn(() => true),
    store: {
      enqueue: jest.fn(async (_payload: CapturePayload, _status: "queued" | "identifying") => {}),
      recordResult: jest.fn(async (_localId: string, _response: IdentifyResponse) => {}),
      requeue: jest.fn(async (_localId: string, _error: string) => {}),
    },
  } satisfies CaptureDependencies;
}

beforeEach(() => {
  mockRemove.mockClear();
  jest.spyOn(console, "debug").mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
});

it("warps, checks, embeds, extracts and stores the capture before sending rounded features", async () => {
  const deps = dependencies();
  const result = await runCapture(input, deps, options);
  expect(result).toMatchObject({ kind: "sent", scanId: "scan-id", response });
  expect(deps.warper.warpCandidates).toHaveBeenCalledWith(input.photoUri, null, 512, true, 1, input.view);
  expect(deps.triage.check).toHaveBeenCalledWith("file:///crop.jpg");
  expect(deps.embedder.embed).toHaveBeenCalledWith("file:///crop.jpg");
  expect(deps.orb.extract).toHaveBeenCalledWith("file:///crop.jpg");
  const payload = expect.objectContaining({
    localId: "capture-uuid",
    vector: [0.12346, -0.98765],
    modelVersion: "test-model",
    capturedAt: 1234,
    photoUri: "file:///photo.jpg",
    cropUri: "file:///crop.jpg",
  });
  expect(deps.store.enqueue).toHaveBeenCalledWith(payload, "identifying");
  expect(deps.identify).toHaveBeenCalledWith(payload);
  expect(deps.store.recordResult).toHaveBeenCalledWith("capture-uuid", response, "device:test-installation");
  const calls = [
    deps.warper.warpCandidates,
    deps.embedder.embed,
    deps.triage.check,
    deps.orb.extract,
    deps.store.enqueue,
    deps.identify,
    deps.store.recordResult,
  ].map((fn) => fn.mock.invocationCallOrder[0]);
  expect(calls).toEqual([...calls].sort((a, b) => a - b));
  expect(deps.store.requeue).not.toHaveBeenCalled();
  expect(result.timings).toEqual({
    warp: expect.any(Number),
    embed: expect.any(Number),
    triage: expect.any(Number),
    orb: expect.any(Number),
    enqueue: expect.any(Number),
    identify: expect.any(Number),
    total: expect.any(Number),
  });
});

it.each(["blur", "glare"] as const)("returns a retake for %s before extracting features", async (reason) => {
  const deps: CaptureDependencies = dependencies();
  deps.triage.check = jest.fn(async () => ({
    ok: false,
    reason,
    message: "Try again",
  }));
  const result = await runCapture(input, deps, options);
  expect(result).toMatchObject({
    kind: "retake",
    reason,
    message: "Try again",
    timings: { triage: expect.any(Number) },
  });
  expect(deps.orb.extract).not.toHaveBeenCalled();
  expect(deps.identify).not.toHaveBeenCalled();
  expect(deps.store.enqueue).not.toHaveBeenCalled();
});

it("queues the crop and binary features when offline", async () => {
  const deps = dependencies();
  deps.isOnline.mockReturnValue(false);
  const result = await runCapture(input, deps, options);
  expect(result).toMatchObject({
    kind: "queued",
    localId: "capture-uuid",
    timings: { enqueue: expect.any(Number) },
  });
  expect(deps.store.enqueue).toHaveBeenCalledWith(
    expect.objectContaining({
      cropUri: "file:///crop.jpg",
      descriptors: expect.any(ArrayBuffer),
      keypoints: expect.any(ArrayBuffer),
    }),
    "queued",
  );
  expect(deps.identify).not.toHaveBeenCalled();
  expect(deps.store.recordResult).not.toHaveBeenCalled();
});

const visitContext: VenueContext = {
  visitLocalId: "local-visit",
  venueId: "museum-1" as VenueContext["venueId"],
};
const atVisit = { ...input, context: Promise.resolve(visitContext) };

describe("while the venue lookup is running", () => {
  const lookup = () => {
    let settle!: (context: VenueContext) => void;
    let fail!: (error: Error) => void;
    const context = new Promise<VenueContext>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
    return { context, settle, fail };
  };
  const inner: PreparedPainting = { ...painting, cropUri: "file:///inner.jpg" };

  it("crops and embeds the photo, then ranks and identifies at the venue it finds", async () => {
    const deps = dependencies();
    deps.warper.warpCandidates.mockResolvedValue([painting, inner]);
    const { context, settle } = lookup();
    const pending = runCapture({ ...input, context }, deps, options);
    await new Promise(setImmediate);
    expect(deps.embedder.embed).toHaveBeenCalledTimes(2);
    expect(deps.rankCrops).not.toHaveBeenCalled();
    expect(deps.store.enqueue).not.toHaveBeenCalled();
    settle({ venueId: visitContext.venueId });
    expect(await pending).toMatchObject({ kind: "sent" });
    expect(deps.rankCrops).toHaveBeenCalledWith(expect.any(Array), "museum-1");
    expect(deps.identify).toHaveBeenCalledWith(expect.objectContaining({ venueId: "museum-1" }));
  });

  it("asks for a retake without waiting for it", async () => {
    const deps = dependencies();
    deps.warper.warpCandidates.mockResolvedValue([]);
    const { context, fail } = lookup();
    expect(await runCapture({ ...input, context }, deps, options)).toMatchObject({ kind: "retake" });
    fail(new Error("Journal owner changed"));
  });

  it("fails the capture with the lookup's error before storing it", async () => {
    const deps = dependencies();
    const { context, fail } = lookup();
    const pending = runCapture({ ...input, context }, deps, options);
    fail(new Error("Journal owner changed"));
    await expect(pending).rejects.toThrow("Journal owner changed");
    expect(deps.store.enqueue).not.toHaveBeenCalled();
  });

  it("does not save or identify a capture canceled during the lookup", async () => {
    const deps = dependencies();
    let active = true;
    const { context, settle } = lookup();
    const pending = runCapture({ ...input, context }, { ...deps, isCurrent: () => active }, options);
    await new Promise(setImmediate);
    expect(deps.embedder.embed).toHaveBeenCalled();
    active = false;
    settle(visitContext);
    await expect(pending).rejects.toThrow("Capture cancelled");
    expect(deps.store.enqueue).not.toHaveBeenCalled();
    expect(deps.identify).not.toHaveBeenCalled();
    expect(mockRemove).toHaveBeenCalledWith(painting.cropUri);
  });
});

it("checks cancellation again after waiting for presentation before persistence", async () => {
  const deps = dependencies();
  let active = true;
  let finish!: () => void;
  const onPrepared = () =>
    new Promise<void>((resolve) => {
      finish = resolve;
    });
  const pending = runCapture(input, { ...deps, onPrepared, isCurrent: () => active }, options);
  await new Promise(setImmediate);
  active = false;
  finish();
  await expect(pending).rejects.toThrow("Capture cancelled");
  expect(deps.store.enqueue).not.toHaveBeenCalled();
  expect(deps.identify).not.toHaveBeenCalled();
});

it.each([true, false])(
  "queues a capture with an unsynced visit when nothing can sync it (online: %s)",
  async (online) => {
    const deps = dependencies();
    deps.isOnline.mockReturnValue(online);
    const result = await runCapture(atVisit, deps, options);
    expect(result).toMatchObject({ kind: "queued" });
    expect(deps.store.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        visitLocalId: "local-visit",
        venueId: "museum-1",
      }),
      "queued",
    );
    expect(deps.identify).not.toHaveBeenCalled();
  },
);

it.each([undefined, "remote-visit"])(
  "syncs the visit before identification, including an existing id: %s",
  async (visitId) => {
    const deps = {
      ...dependencies(),
      resolveVisitId: jest.fn(async () => "remote-visit" as NonNullable<CapturePayload["visitId"]>),
    };
    const result = await runCapture(
      { ...input, context: Promise.resolve({ ...visitContext, visitId: visitId as VenueContext["visitId"] }) },
      deps,
      options,
    );
    expect(deps.resolveVisitId).toHaveBeenCalledWith("local-visit");
    expect(result).toMatchObject({ kind: "sent", scanId: "scan-id" });
    expect(deps.store.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        visitLocalId: "local-visit",
        visitId: "remote-visit",
      }),
      "identifying",
    );
    expect(deps.identify).toHaveBeenCalledWith(
      expect.objectContaining({ visitId: "remote-visit", venueId: "museum-1" }),
    );
  },
);

it.each([undefined, "remote-visit"])(
  "queues when visit sync fails or times out, including an existing id: %s",
  async (visitId) => {
    const capture = {
      ...input,
      context: Promise.resolve({ ...visitContext, visitId: visitId as VenueContext["visitId"] }),
    };
    jest.spyOn(console, "warn").mockImplementation(() => {});
    const failing = {
      ...dependencies(),
      resolveVisitId: jest.fn(async () => {
        throw new Error("offline");
      }),
    };
    expect(await runCapture(capture, failing, options)).toMatchObject({
      kind: "queued",
    });
    expect(failing.store.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        visitLocalId: "local-visit",
        visitId: undefined,
      }),
      "queued",
    );
    expect(failing.identify).not.toHaveBeenCalled();

    jest.useFakeTimers();
    try {
      const slow = {
        ...dependencies(),
        resolveVisitId: jest.fn(() => new Promise<NonNullable<CapturePayload["visitId"]>>(() => {})),
      };
      const pending = runCapture(capture, slow, options);
      await jest.advanceTimersByTimeAsync(4000);
      expect(await pending).toMatchObject({ kind: "queued" });
      expect(slow.identify).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }

    const offline = { ...dependencies(), resolveVisitId: jest.fn() };
    offline.isOnline.mockReturnValue(false);
    await runCapture(capture, offline, options);
    expect(offline.resolveVisitId).not.toHaveBeenCalled();
  },
);

it.each([
  new Error("Connection lost while action was in flight"),
  new Error("[CONVEX A(identify:identify)] Connection lost while action was in flight\n  Called by client"),
  new TypeError("Network request failed"),
  new TypeError("Failed to fetch"),
])("returns the stored capture to the queue after a transport failure: %s", async (error) => {
  const deps = dependencies();
  deps.identify.mockRejectedValue(error);
  expect(await runCapture(input, deps, options)).toMatchObject({
    kind: "queued",
    localId: "capture-uuid",
  });
  expect(deps.store.enqueue).toHaveBeenCalledTimes(1);
  expect(deps.store.enqueue.mock.calls[0][0]).toBe(deps.identify.mock.calls[0][0]);
  expect(deps.store.requeue).toHaveBeenCalledWith("capture-uuid", error.message, "device:test-installation");
  expect(deps.embedder.embed).toHaveBeenCalledTimes(1);
});

it.each([
  [new ConvexError({ code: "rate_limited" }), "rate_limited"],
  [new Error("Invalid vector"), "Invalid vector"],
  [new TypeError("Bad implementation"), "Bad implementation"],
])("surfaces non-network failures but keeps the capture queued: %s", async (error, message) => {
  const deps = dependencies();
  deps.identify.mockRejectedValue(error);
  await expect(runCapture(input, deps, options)).rejects.toBe(error);
  expect(deps.store.requeue).toHaveBeenCalledWith("capture-uuid", message, "device:test-installation");
  expect(deps.store.recordResult).not.toHaveBeenCalled();
});

it("does not send or report queued if the store rejects the write", async () => {
  const deps = dependencies();
  deps.store.enqueue.mockRejectedValue(new Error("Disk full"));
  await expect(runCapture(input, deps, options)).rejects.toThrow("Disk full");
  expect(deps.identify).not.toHaveBeenCalled();
});

it.each([
  ["orb", (deps: ReturnType<typeof dependencies>) => deps.orb.extract.mockRejectedValue(new Error("OpenCV failed"))],
  ["enqueue", (deps: ReturnType<typeof dependencies>) => deps.store.enqueue.mockRejectedValue(new Error("Disk full"))],
  [
    "identify",
    (deps: ReturnType<typeof dependencies>) => deps.identify.mockRejectedValue(new ConvexError({ code: "bad_crop" })),
  ],
  [
    "record_result",
    (deps: ReturnType<typeof dependencies>) => deps.store.recordResult.mockRejectedValue(new Error("Disk full")),
  ],
  [
    "requeue",
    (deps: ReturnType<typeof dependencies>) => {
      deps.identify.mockRejectedValue(new ConvexError({ code: "bad_crop" }));
      deps.store.requeue.mockRejectedValue(new Error("Disk full"));
    },
  ],
] as const)("names the %s step that failed, so a report can tell the steps apart", async (step, fail) => {
  const deps = dependencies();
  fail(deps);
  const error = await runCapture(input, deps, options).catch((cause: unknown) => cause);
  expect(failureDetails(error)).toEqual({ step });
});

it("rejects a model mismatch before processing the photo", async () => {
  const deps = dependencies();
  deps.embedder.modelVersion = "other-model";
  await expect(runCapture(input, deps, options)).rejects.toThrow("model version");
  expect(deps.warper.warpCandidates).not.toHaveBeenCalled();
});

it("keeps a capture made before registration when the same installation becomes ready", async () => {
  switchOwner(anonymousOwner());
  const deps = dependencies();
  deps.embedder.embed.mockImplementation(async () => {
    switchOwner(anonymousOwner(), "test-scope");
    return new Float32Array([1]);
  });
  expect(await runCapture(input, deps, options)).toMatchObject({
    kind: "queued",
  });
  expect(deps.store.enqueue).toHaveBeenCalledWith(expect.objectContaining({ owner: anonymousOwner() }), "queued");
  expect(deps.identify).not.toHaveBeenCalled();
});

it("requires a still boundary before quality checks, recognition, or persistence", async () => {
  const deps = dependencies();
  deps.warper.warpCandidates.mockResolvedValue([]);
  expect(await runCapture({ ...input, source: "camera" }, deps, options)).toMatchObject({
    kind: "retake",
    reason: "boundary",
    message: expect.stringMatching(/hold steady/),
  });
  expect(deps.triage.check).not.toHaveBeenCalled();
  expect(deps.embedder.embed).not.toHaveBeenCalled();
  expect(deps.store.enqueue).not.toHaveBeenCalled();
});

it("starts preparation presentation concurrently but retains images before persistence moves them", async () => {
  const deps = dependencies();
  let retained!: () => void;
  const onPrepared = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        retained = resolve;
      }),
  );
  const pending = runCapture(input, { ...deps, onPrepared }, options);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(onPrepared).toHaveBeenCalledWith(painting);
  expect(deps.embedder.embed).toHaveBeenCalledTimes(1);
  expect(deps.store.enqueue).not.toHaveBeenCalled();
  retained();
  expect(await pending).toMatchObject({ kind: "sent" });
  expect(deps.identify).toHaveBeenCalledTimes(1);
  expect(deps.store.enqueue.mock.calls[0][0]).toHaveProperty("contentBounds", painting.contentBounds);
});

it("preserves recognition when presentation decoding fails", async () => {
  const deps = dependencies();
  expect(
    await runCapture(
      input,
      {
        ...deps,
        onPrepared: async () => {
          throw new Error("Image failed");
        },
      },
      options,
    ),
  ).toMatchObject({ kind: "sent" });
  expect(deps.identify).toHaveBeenCalledTimes(1);
});

it("recognizes a persisted offline capture locally without delaying the queued result or changing the reconnect queue", async () => {
  const deps = dependencies();
  deps.isOnline.mockReturnValue(false);
  let finish!: () => void;
  const recognizeOffline = jest.fn(() => {
    expect(deps.store.enqueue).toHaveBeenCalled();
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  const result = await runCapture(input, { ...deps, recognizeOffline }, options);
  expect(result).toMatchObject({ kind: "queued", localId: "capture-uuid" });
  expect(recognizeOffline).toHaveBeenCalledWith(
    expect.objectContaining({
      localId: "capture-uuid",
      owner: "device:test-installation",
    }),
  );
  expect(deps.identify).not.toHaveBeenCalled();
  finish();
});

it("falls back to local recognition after connectivity fails during identification", async () => {
  const deps = dependencies();
  deps.identify.mockRejectedValue(new Error("Network request failed"));
  const recognizeOffline = jest.fn(async () => {});
  const result = await runCapture(input, { ...deps, recognizeOffline }, options);
  expect(result.kind).toBe("queued");
  expect(deps.store.requeue).toHaveBeenCalled();
  expect(recognizeOffline).toHaveBeenCalled();
});

it("retains the reconnect queue if a downloaded package is unavailable", async () => {
  const deps = dependencies();
  deps.isOnline.mockReturnValue(false);
  jest.spyOn(console, "warn").mockImplementation(() => {});
  const result = await runCapture(
    input,
    {
      ...deps,
      recognizeOffline: async () => {
        throw new Error("Missing file");
      },
    },
    options,
  );
  expect(result.kind).toBe("queued");
  expect(deps.store.enqueue).toHaveBeenCalled();
});

describe("a painting inside a larger boundary, such as a phone screen", () => {
  const inner: PreparedPainting = { ...painting, cropUri: "file:///inner.jpg" };

  it("identifies the nested crop the server ranks best and discards the outer one", async () => {
    const deps = dependencies();
    deps.warper.warpCandidates.mockResolvedValue([painting, inner]);
    deps.rankCrops.mockResolvedValue(1);
    const onPrepared = jest.fn(async () => {});
    const venueId = "museum-1" as VenueContext["venueId"];
    const result = await runCapture(
      { ...input, context: Promise.resolve({ venueId }) },
      { ...deps, onPrepared },
      options,
    );
    expect(result).toMatchObject({ kind: "sent", timings: { rank: expect.any(Number) } });
    expect(deps.rankCrops).toHaveBeenCalledWith(
      [
        [0.12346, -0.98765],
        [0.12346, -0.98765],
      ],
      venueId,
    );
    expect(deps.triage.check).toHaveBeenCalledWith(inner.cropUri);
    expect(onPrepared).toHaveBeenCalledWith(inner);
    expect(deps.orb.extract).toHaveBeenCalledWith(inner.cropUri);
    expect(deps.identify).toHaveBeenCalledWith(expect.objectContaining({ cropUri: inner.cropUri }));
    expect(mockRemove.mock.calls).toEqual([[painting.cropUri]]);
  });

  it("asks for nested crops only when it can rank them", async () => {
    const offline = dependencies();
    offline.isOnline.mockReturnValue(false);
    await runCapture(input, offline, options);
    expect(offline.warper.warpCandidates).toHaveBeenCalledWith(input.photoUri, null, 512, false, 1, input.view);
    const { rankCrops: _rankCrops, ...unranked } = dependencies();
    await runCapture(input, unranked, options);
    expect(unranked.warper.warpCandidates).toHaveBeenCalledWith(input.photoUri, null, 512, false, 1, input.view);
  });
});
