import type { HybridObject } from 'react-native-nitro-modules';
import type { Frame } from 'react-native-vision-camera';

/** A point in normalized upright-image coordinates: origin top-left, x to the right, y down. */
export interface RectPoint {
  x: number;
  y: number;
}

export interface RectObservation {
  confidence: number;
  /** Corners in order top-left, top-right, bottom-right, bottom-left. */
  corners: RectPoint[];
}

export interface RectDetection {
  /** Upright image size in pixels. */
  width: number;
  height: number;
  /** Sorted by area, largest first. */
  observations: RectObservation[];
}

export interface LetterboxResult {
  cropPath: string;
  /** The region that was warped, normalized to the upright still; the whole image when no quad was given. */
  usedQuad: RectPoint[];
  /** Per-channel mean of the resized crop, the pad color: [r, g, b] in 0–255. */
  meanColor: number[];
}

export interface VisionRect extends HybridObject<{ ios: 'swift' }> {
  /**
   * Runs rectangle detection on every `stride`-th call and returns `undefined` for the calls in between.
   * Call from the frame worklet; the caller disposes the frame.
   */
  detect(frame: Frame, stride: number): RectDetection | undefined;
  detectStill(photoPath: string): Promise<RectDetection>;
  warpAndLetterbox(photoPath: string, quad: RectPoint[] | undefined, size: number): Promise<LetterboxResult>;
}
