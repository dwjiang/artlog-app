import {
  clampOffset,
  containSize,
  DOUBLE_TAP_ZOOM,
  dismissProgress,
  doubleTapZoom,
  MAX_ZOOM,
  panLimits,
  PINCH_CLOSE_SCALE,
  pinchOffset,
  pinchScale,
  rubberBand,
  settledZoom,
  shouldDismiss,
} from "./photo-zoom";

const screen = { width: 400, height: 800 };
// A landscape painting fitted to the screen's width.
const fitted = containSize({ width: 2000, height: 1000 }, screen);

it("fits a picture inside the screen without cropping, and fills it while the size is unknown", () => {
  expect(fitted).toEqual({ width: 400, height: 200 });
  expect(containSize({ width: 1000, height: 4000 }, screen)).toEqual({ width: 200, height: 800 });
  expect(containSize(undefined, screen)).toEqual(screen);
});

it("lets a zoomed picture move only until its edge reaches the screen's edge", () => {
  expect(panLimits(fitted, screen, 1)).toEqual({ x: 0, y: 0 });
  expect(panLimits(fitted, screen, 3)).toEqual({ x: 400, y: 0 });
  expect(panLimits(fitted, screen, 5)).toEqual({ x: 800, y: 100 });
  expect(clampOffset({ x: 900, y: -150 }, { x: 800, y: 100 })).toEqual({ x: 800, y: -100 });
});

it("resists a drag past the edge instead of stopping it", () => {
  expect(rubberBand(50, 100)).toBe(50);
  const past = rubberBand(160, 100);
  expect(past).toBeGreaterThan(100);
  expect(past).toBeLessThan(160);
  expect(rubberBand(-160, 100)).toBe(-past);
});

it("keeps the spot under the fingers in place while pinching", () => {
  const start = { scale: 1, offset: { x: 0, y: 0 }, focal: { x: 100, y: -50 } };
  const offset = pinchOffset(start, 2, { x: 100, y: -50 });
  // The picture point under the fingers (100, -50) draws at offset + scale * point.
  expect(offset.x + 2 * 100).toBe(100);
  expect(offset.y + 2 * -50).toBe(-50);
  // Moving the fingers carries the picture with them.
  expect(pinchOffset(start, 2, { x: 130, y: -50 })).toEqual({ x: -70, y: 50 });
});

it("double-tap zooms in on the tapped spot within the edges, and back out when zoomed", () => {
  const zoomed = doubleTapZoom(1, { x: 100, y: 0 }, fitted, screen);
  expect(zoomed.scale).toBe(DOUBLE_TAP_ZOOM);
  expect(zoomed.offset.x).toBe(-100 * (DOUBLE_TAP_ZOOM - 1));
  expect(zoomed.offset.y).toBe(0);
  // A tap near the picture's edge zooms only as far as the edge allows.
  const edge = doubleTapZoom(1, { x: 200, y: 300 }, fitted, screen);
  expect(edge.offset).toEqual({ x: -300, y: 0 });
  expect(doubleTapZoom(2, { x: 100, y: 0 }, fitted, screen)).toEqual({ scale: 1, offset: { x: 0, y: 0 } });
});

it("lets a pinch overshoot the zoom range with resistance, and far enough below fitting to close", () => {
  expect(pinchScale(1, 2)).toBe(2);
  expect(pinchScale(2, 3)).toBeGreaterThan(MAX_ZOOM);
  expect(pinchScale(2, 3)).toBeLessThan(6);
  expect(pinchScale(1, 0.6)).toBeLessThan(PINCH_CLOSE_SCALE);
  expect(pinchScale(1, 0.1)).toBe(0.5);
});

it("settles a pinch back inside the zoom range and the picture's edges", () => {
  expect(settledZoom(0.8, { x: 30, y: 10 }, fitted, screen)).toEqual({ scale: 1, offset: { x: 0, y: 0 } });
  const settled = settledZoom(6, { x: 3000, y: 0 }, fitted, screen);
  expect(settled.scale).toBe(4);
  expect(settled.offset).toEqual(clampOffset({ x: 2000, y: 0 }, panLimits(fitted, screen, 4)));
});

it("dismisses after a long or fast drag away, but not when the drag heads back", () => {
  expect(shouldDismiss(40, 100, 800)).toBe(false);
  expect(shouldDismiss(160, 0, 800)).toBe(true);
  expect(shouldDismiss(-160, -50, 800)).toBe(true);
  expect(shouldDismiss(40, 1200, 800)).toBe(true);
  expect(shouldDismiss(160, -600, 800)).toBe(false);
  expect(dismissProgress(0, 800)).toBe(0);
  expect(dismissProgress(-160, 800)).toBe(0.5);
  expect(dismissProgress(2000, 800)).toBe(1);
});
