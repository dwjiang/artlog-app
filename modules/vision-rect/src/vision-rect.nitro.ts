import type { HybridObject } from "react-native-nitro-modules";
import type { Frame } from "react-native-vision-camera";

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

export interface SubjectObservation {
  /** Share of the image covered by the subject's largest connected region. */
  area: number;
  /** Region area over quad area: about 1 for a quadrilateral, further off for rounder shapes such as people. */
  quadFill: number;
  /** Corners fitted to the region's sides, in order top-left, top-right, bottom-right, bottom-left. */
  quad: RectPoint[];
}

export interface StillDetection {
  /** Size in pixels of the image as analyzed: upright, then turned counterclockwise by the requested quarter turns. */
  width: number;
  height: number;
  /** Rectangle candidates, largest first. */
  rectangles: RectObservation[];
  /** Foreground subjects lifted from the background, largest first. */
  subjects: SubjectObservation[];
  /** Why subject lifting produced nothing, when it did: its error (the iOS Simulator cannot run it) or what it rejected. */
  subjectNote?: string;
}

export interface CropContentBounds {
  /** Pixels in the square model crop, with a top-left origin. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LetterboxResult {
  cropPath: string;
  contentBounds: CropContentBounds;
  /** The region that was warped, normalized to the upright still; the whole image when no quad was given. */
  usedQuad: RectPoint[];
  /** Per-channel mean of the resized crop, the pad color: [r, g, b] in 0–255. */
  meanColor: number[];
}

export interface TextLine {
  text: string;
  /** The recognizer's confidence in `text`, 0–1. */
  confidence: number;
  /** Bounds in normalized upright-image coordinates with a top-left origin. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextRecognition {
  /** Upright image size in pixels. */
  width: number;
  height: number;
  /** Reading order: top to bottom, then left to right within a row. */
  lines: TextLine[];
}

export interface VisionRect extends HybridObject<{ ios: "swift" }> {
  /**
   * Runs rectangle detection on every `stride`-th call and returns `undefined` for the calls in between.
   * Call from the frame worklet; the caller disposes the frame.
   */
  detect(frame: Frame, stride: number): RectDetection | undefined;
  /**
   * Rectangle detection and subject lifting on a captured still or library photo. The upright image is
   * analyzed turned counterclockwise by `turns` quarter turns, so a photo taken with the phone turned is
   * seen the way the portrait preview saw it; corners are normalized to that turned image.
   */
  detectStill(photoPath: string, turns: number): Promise<StillDetection>;
  warpAndLetterbox(photoPath: string, quad: RectPoint[] | undefined, size: number): Promise<LetterboxResult>;
  /** Reads printed text on a captured still or library photo with Apple Vision; nothing leaves the phone. */
  recognizeText(photoPath: string): Promise<TextRecognition>;
}
