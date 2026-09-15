import type { FrameSize } from './rectangle';
import type { PreparedPainting, Quad } from './stages';

export function perspectiveMatrix(width: number, height: number, quad: Quad): number[] | null {
  'worklet';
  if (!(width > 0 && height > 0) || !quad.every((p) => p.every(Number.isFinite))) return null;
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const determinant = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(determinant) < 1e-8) return null;
  const g = (dx3 * dy2 - dx2 * dy3) / determinant;
  const h = (dx1 * dy3 - dx3 * dy1) / determinant;
  if ([1, 1 + g, 1 + h, 1 + g + h].some((w) => w <= 1e-6)) return null;
  // React Native's column-major 4×4 matrix, with transformOrigin at the top-left.
  return [
    (x1 - x0 + g * x1) / width, (y1 - y0 + g * y1) / width, 0, g / width,
    (x3 - x0 + h * x3) / height, (y3 - y0 + h * y3) / height, 0, h / height,
    0, 0, 1, 0,
    x0, y0, 0, 1,
  ];
}

export function interpolateCorners(from: Quad, to: Quad, progress: number): Quad {
  'worklet';
  return from.map(([x, y], i) => [x + (to[i][0] - x) * progress, y + (to[i][1] - y) * progress]) as Quad;
}

export function revealGeometry(painting: PreparedPainting, view: FrameSize, fit: 'cover' | 'contain', insets = { top: 0, bottom: 0 }) {
  const { photoSize: photo, contentBounds: bounds, cropSize } = painting;
  if (![photo.width, photo.height, view.width, view.height, bounds.width, bounds.height, cropSize].every((n) => Number.isFinite(n) && n > 0)
    || bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > cropSize || bounds.y + bounds.height > cropSize) return null;
  const photoScale = (fit === 'cover' ? Math.max : Math.min)(view.width / photo.width, view.height / photo.height);
  const from = painting.corners.map(([x, y]) => [
    x * photo.width * photoScale + (view.width - photo.width * photoScale) / 2,
    y * photo.height * photoScale + (view.height - photo.height * photoScale) / 2,
  ]) as Quad;
  const availableHeight = view.height - insets.top - insets.bottom;
  const scale = Math.min((view.width - 48) / bounds.width, Math.min(view.height * 0.6, availableHeight) / bounds.height);
  const width = bounds.width * scale, height = bounds.height * scale;
  const left = (view.width - width) / 2, top = insets.top + (availableHeight - height) / 2;
  const to: Quad = [[left, top], [left + width, top], [left + width, top + height], [left, top + height]];
  if (!perspectiveMatrix(width, height, from) || !perspectiveMatrix(width, height, to)) return null;
  return { from, to, width, height, imageSize: cropSize * scale, imageLeft: -bounds.x * scale, imageTop: -bounds.y * scale };
}
