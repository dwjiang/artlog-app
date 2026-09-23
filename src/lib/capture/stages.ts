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

export interface Warper {
  warpAndLetterbox(
    photoUri: string,
    quad: Quad | null,
    size: number,
  ): Promise<PreparedPainting | null>;
}

export interface Triage {
  check(
    cropUri: string,
  ): Promise<{ ok: true } | { ok: false; reason: "blur" | "glare"; message: string }>;
}

export interface Embedder {
  embed(cropUri: string): Promise<Float32Array>;
  modelVersion: string;
}

export interface OrbExtractor {
  extract(
    cropUri: string,
  ): Promise<{ descriptors: ArrayBuffer; keypoints: ArrayBuffer; count: number }>;
}

export type IdentifyResponse = FunctionReturnType<typeof api.identify.identify>;
export type CapturePayload = Omit<FunctionArgs<typeof api.identify.identify>, "scope"> & {
  owner: string;
  scope?: string;
  photoUri: string;
  cropUri: string;
  contentBounds: CropContentBounds;
  visitLocalId?: string;
};
export type CaptureInput = Pick<
  CapturePayload,
  "capturedAt" | "venueId" | "visitId" | "visitLocalId"
> & {
  photoUri: string;
  quad: Quad | null;
  source: "camera" | "library";
};
export type CaptureTimings = Partial<
  Record<"warp" | "triage" | "embed" | "orb" | "identify" | "enqueue", number>
> & {
  total: number;
};
export type CaptureResult = (
  | { kind: "retake"; reason: "boundary" | "blur" | "glare"; message: string }
  | { kind: "sent"; scanId: IdentifyResponse["scanId"]; response: IdentifyResponse }
  | { kind: "queued"; localId: string }
) & { timings: CaptureTimings };

/** The local capture store: every capture is persisted before any network call. */
export interface CaptureStore {
  /** Moves the photo and crop into place and inserts the row; `identifying` claims it for the inline identify. */
  enqueue(payload: CapturePayload, status: "queued" | "identifying"): Promise<void>;
  recordResult(localId: string, response: IdentifyResponse, owner?: string): Promise<void>;
  /** Returns the row to the queue after the inline identify failed, so the flusher retries it. */
  requeue(localId: string, error: string, owner?: string): Promise<void>;
}

export type CaptureDependencies = {
  warper: Warper;
  triage: Triage;
  embedder: Embedder;
  orb: OrbExtractor;
  identify: (payload: CapturePayload) => Promise<IdentifyResponse>;
  isOnline: () => boolean;
  recognizeOffline?: (payload: CapturePayload) => Promise<void>;
  /** Syncs a visit the server has not seen yet, so the first scan at a museum identifies now instead of queuing. */
  resolveVisitId?: (
    visitLocalId: string,
    venueId: NonNullable<CapturePayload["venueId"]>,
  ) => Promise<NonNullable<CapturePayload["visitId"]>>;
  store: CaptureStore;
  /** Retain presentation images before enqueue moves their files. Visual errors must not fail capture. */
  onPrepared?: (painting: PreparedPainting) => Promise<void>;
};

export type CaptureOptions = { inputSize: number; modelVersion: string };
