import type { FunctionArgs, FunctionReturnType } from 'convex/server';

import type { api } from '../../../convex/_generated/api';

export type Quad = [[number, number], [number, number], [number, number], [number, number]];

export interface Warper {
  warpAndLetterbox(photoUri: string, quad: Quad | null, size: number): Promise<{ cropUri: string }>;
}

export interface Triage {
  check(cropUri: string): Promise<{ ok: true } | { ok: false; reason: 'blur' | 'glare'; message: string }>;
}

export interface Embedder {
  embed(cropUri: string): Promise<Float32Array>;
  modelVersion: string;
}

export interface OrbExtractor {
  extract(cropUri: string): Promise<{ descriptors: ArrayBuffer; keypoints: ArrayBuffer; count: number }>;
}

export type IdentifyResponse = FunctionReturnType<typeof api.identify.identify>;
export type CapturePayload = FunctionArgs<typeof api.identify.identify> & { cropUri: string };
export type CaptureInput = Pick<CapturePayload, 'capturedAt' | 'venueId' | 'visitId'> & {
  photoUri: string;
  quad: Quad | null;
  source: 'camera' | 'library';
};
export type CaptureTimings = Partial<Record<'warp' | 'triage' | 'embed' | 'orb' | 'identify' | 'enqueue', number>> & {
  total: number;
};
export type CaptureResult = (
  | { kind: 'retake'; reason: 'blur' | 'glare'; message: string }
  | { kind: 'sent'; scanId: IdentifyResponse['scanId']; response: IdentifyResponse }
  | { kind: 'queued'; localId: string }
) & { timings: CaptureTimings };

export type CaptureDependencies = {
  warper: Warper;
  triage: Triage;
  embedder: Embedder;
  orb: OrbExtractor;
  identify: (payload: CapturePayload) => Promise<IdentifyResponse>;
  isOnline: () => boolean;
  enqueue: (payload: CapturePayload) => Promise<void>;
};

export type CaptureOptions = { inputSize: number; modelVersion: string };
