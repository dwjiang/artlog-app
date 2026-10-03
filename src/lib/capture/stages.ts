import type { FunctionArgs, FunctionReturnType } from "convex/server";

import type { api } from "../../../convex/_generated/api";
import type { CropContentBounds } from "../../../modules/vision-rect/src";

export type Quad = [[number, number], [number, number], [number, number], [number, number]];

export type PreparedPainting = {
  cropUri: string;
  corners: Quad;
  photoSize: { width: number; height: number };
  contentBounds: CropContentBounds;
  cropSize: number;
};

export type Warper = {
  /**
   * Warps the likeliest painting boundary first; with `nested`, also the boundaries inside it that recognition
   * may prefer, such as a painting shown on a phone. Empty when the photo has no boundary.
   */
  warpCandidates(photoUri: string, quad: Quad | null, size: number, nested: boolean): Promise<PreparedPainting[]>;
};

/** Index of the crop to identify among the candidates' vectors, the likeliest boundary first. */
export type CropRanker = (vectors: number[][]) => Promise<number>;

export type Triage = {
  check(cropUri: string): Promise<{ ok: true } | { ok: false; reason: "blur" | "glare"; message: string }>;
};

export type Embedder = {
  embed(cropUri: string): Promise<Float32Array>;
  modelVersion: string;
};

export type OrbExtractor = {
  extract(cropUri: string): Promise<{
    descriptors: ArrayBuffer;
    keypoints: ArrayBuffer;
    count: number;
  }>;
};

export type IdentifyResponse = FunctionReturnType<typeof api.identify.identify>;
export type CapturePayload = Omit<FunctionArgs<typeof api.identify.identify>, "scope"> & {
  owner: string;
  scope?: string;
  photoUri: string;
  cropUri: string;
  cropCorners: Quad;
  contentBounds: CropContentBounds;
  visitLocalId?: string;
};
export type CaptureInput = Pick<CapturePayload, "capturedAt" | "venueId" | "visitId" | "visitLocalId"> & {
  photoUri: string;
  quad: Quad | null;
  source: "camera" | "library";
};
export type CaptureTimings = Partial<
  Record<"warp" | "embed" | "rank" | "triage" | "orb" | "identify" | "enqueue", number>
> & {
  total: number;
};
export type CaptureResult = (
  | { kind: "retake"; reason: "boundary" | "blur" | "glare"; message: string }
  | {
      kind: "sent";
      scanId: IdentifyResponse["scanId"];
      response: IdentifyResponse;
    }
  | { kind: "queued"; localId: string }
) & { timings: CaptureTimings };

/** The local capture store: every capture is persisted before any network call. */
export type CaptureStore = {
  /** Moves the photo and crop into place and inserts the row; `identifying` claims it for the inline identify. */
  enqueue(payload: CapturePayload, status: "queued" | "identifying"): Promise<void>;
  recordResult(localId: string, response: IdentifyResponse, owner?: string): Promise<void>;
  /** Returns the row to the queue after the inline identify failed, so the flusher retries it. */
  requeue(localId: string, error: string, owner?: string): Promise<void>;
};

export type CaptureDependencies = {
  warper: Warper;
  triage: Triage;
  embedder: Embedder;
  orb: OrbExtractor;
  identify: (payload: CapturePayload) => Promise<IdentifyResponse>;
  /** Online only; without it, the likeliest boundary is identified. */
  rankCrops?: (vectors: number[][], venueId: CapturePayload["venueId"]) => Promise<number>;
  isOnline: () => boolean;
  recognizeOffline?: (payload: CapturePayload) => Promise<void>;
  /** Syncs a visit's pending edits before identification uses its museum, including visits with an existing remote ID. */
  resolveVisitId?: (visitLocalId: string) => Promise<NonNullable<CapturePayload["visitId"]>>;
  store: CaptureStore;
  /** Retain presentation images before enqueue moves their files. Visual errors must not fail capture. */
  onPrepared?: (painting: PreparedPainting) => Promise<void>;
};

export type CaptureOptions = { inputSize: number; modelVersion: string };
