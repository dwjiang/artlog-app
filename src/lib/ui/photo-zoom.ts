// Geometry for the full-screen photo viewer's gestures. Points and offsets are measured from the screen's center, and
// a picture at `scale` with `offset` draws a picture point p at offset + scale * p. Gesture callbacks run these on the
// UI thread, so each is a worklet.

export type Size = { width: number; height: number };
export type Point = { x: number; y: number };

export const MAX_ZOOM = 4;
export const DOUBLE_TAP_ZOOM = 2.5;
/** A pinch released below this scale closes the viewer, as it does in Photos. */
export const PINCH_CLOSE_SCALE = 0.75;
const MIN_PINCH_SCALE = 0.5;
const RUBBER_BAND = 0.3;

/** The size `content` draws at when fitted inside `frame` without cropping; the whole frame while it's unknown. */
export function containSize(content: Size | undefined, frame: Size): Size {
  "worklet";
  if (!content || content.width <= 0 || content.height <= 0) return frame;
  const fit = Math.min(frame.width / content.width, frame.height / content.height);
  return { width: content.width * fit, height: content.height * fit };
}

/** How far from center a picture zoomed to `scale` can move before its edge comes inside the frame's edge. */
export function panLimits(fitted: Size, frame: Size, scale: number): Point {
  "worklet";
  return {
    x: Math.max(0, (fitted.width * scale - frame.width) / 2),
    y: Math.max(0, (fitted.height * scale - frame.height) / 2),
  };
}

function clamp(value: number, limit: number) {
  "worklet";
  // `|| 0` keeps a centered offset from turning into -0.
  return Math.max(-limit, Math.min(limit, value)) || 0;
}

export function clampOffset(offset: Point, limits: Point): Point {
  "worklet";
  return { x: clamp(offset.x, limits.x), y: clamp(offset.y, limits.y) };
}

/** A drag past `limit` moves at a fraction of the finger's speed. */
export function rubberBand(value: number, limit: number): number {
  "worklet";
  const over = Math.abs(value) - limit;
  return over <= 0 ? value : Math.sign(value) * (limit + over * RUBBER_BAND);
}

/** The pinch's scale, letting it shrink below fitting only far enough to show it can close the viewer. */
export function pinchScale(startScale: number, gestureScale: number): number {
  "worklet";
  const scale = startScale * gestureScale;
  return Math.max(MIN_PINCH_SCALE, scale > MAX_ZOOM ? MAX_ZOOM + (scale - MAX_ZOOM) * RUBBER_BAND : scale);
}

/** Keeps the picture point that was under the fingers at the pinch's start under them as it scales and moves. */
export function pinchOffset(start: { scale: number; offset: Point; focal: Point }, scale: number, focal: Point): Point {
  "worklet";
  const ratio = scale / start.scale;
  return {
    x: focal.x - ratio * (start.focal.x - start.offset.x),
    y: focal.y - ratio * (start.focal.y - start.offset.y),
  };
}

/** Where a pinch or drag comes to rest: within the zoom range, about the screen's center, and inside the edges. */
export function settledZoom(scale: number, offset: Point, fitted: Size, frame: Size) {
  "worklet";
  const target = Math.max(1, Math.min(MAX_ZOOM, scale));
  const ratio = target / scale;
  return {
    scale: target,
    offset: clampOffset({ x: offset.x * ratio, y: offset.y * ratio }, panLimits(fitted, frame, target)),
  };
}

/** A double tap zooms in on the tapped point, or back out to fit once zoomed. */
export function doubleTapZoom(scale: number, point: Point, fitted: Size, frame: Size) {
  "worklet";
  if (scale > 1.01) return { scale: 1, offset: { x: 0, y: 0 } };
  const offset = { x: -point.x * (DOUBLE_TAP_ZOOM - 1), y: -point.y * (DOUBLE_TAP_ZOOM - 1) };
  return { scale: DOUBLE_TAP_ZOOM, offset: clampOffset(offset, panLimits(fitted, frame, DOUBLE_TAP_ZOOM)) };
}

/** A drag of the fitted picture closes the viewer when it went far or fast enough and isn't heading back. */
export function shouldDismiss(translation: number, velocity: number, frameHeight: number): boolean {
  "worklet";
  const returning = translation * velocity < 0 && Math.abs(velocity) > 200;
  return !returning && (Math.abs(velocity) > 800 || Math.abs(translation) > frameHeight * 0.15);
}

/** How far a dismissing drag has gone, from 0 at rest to 1, for fading the backdrop and shrinking the picture. */
export function dismissProgress(translation: number, frameHeight: number): number {
  "worklet";
  return Math.min(1, Math.abs(translation) / (frameHeight * 0.4));
}
