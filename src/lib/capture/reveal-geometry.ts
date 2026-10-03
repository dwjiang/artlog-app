import { turnCorners, type FrameSize } from "./rectangle";
import type { PreparedPainting, Quad } from "./stages";

export function perspectiveMatrix(width: number, height: number, quad: Quad): number[] | null {
  "worklet";
  if (!(width > 0 && height > 0) || !quad.every((p) => p.every(Number.isFinite))) {
    return null;
  }
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  const determinant = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(determinant) < 1e-8) return null;
  const g = (dx3 * dy2 - dx2 * dy3) / determinant;
  const h = (dx1 * dy3 - dx3 * dy1) / determinant;
  if ([1, 1 + g, 1 + h, 1 + g + h].some((w) => w <= 1e-6)) return null;
  // React Native's column-major 4×4 matrix, with transformOrigin at the top-left.
  return [
    (x1 - x0 + g * x1) / width,
    (y1 - y0 + g * y1) / width,
    0,
    g / width,
    (x3 - x0 + h * x3) / height,
    (y3 - y0 + h * y3) / height,
    0,
    h / height,
    0,
    0,
    1,
    0,
    x0,
    y0,
    0,
    1,
  ];
}

export function interpolateCorners(from: Quad, to: Quad, progress: number): Quad {
  "worklet";
  const fromCenter = from.reduce(([cx, cy], [x, y]) => [cx + x / 4, cy + y / 4], [0, 0]);
  const toCenter = to.reduce(([cx, cy], [x, y]) => [cx + x / 4, cy + y / 4], [0, 0]);
  const fromEdge = [from[1][0] - from[0][0], from[1][1] - from[0][1]];
  const toEdge = [to[1][0] - to[0][0], to[1][1] - to[0][1]];
  // Align the top edges before morphing the shape: a half-turn otherwise sends opposite corners through each other.
  const rotation = Math.atan2(
    fromEdge[1] * toEdge[0] - fromEdge[0] * toEdge[1],
    fromEdge[0] * toEdge[0] + fromEdge[1] * toEdge[1],
  );
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const remainingCos = Math.cos(rotation * (1 - progress));
  const remainingSin = Math.sin(rotation * (1 - progress));
  const centerX = fromCenter[0] + (toCenter[0] - fromCenter[0]) * progress;
  const centerY = fromCenter[1] + (toCenter[1] - fromCenter[1]) * progress;
  return from.map(([x, y], index) => {
    const dx = x - fromCenter[0];
    const dy = y - fromCenter[1];
    const alignedX = dx * cos + dy * sin;
    const alignedY = -dx * sin + dy * cos;
    const nextX = alignedX + (to[index][0] - toCenter[0] - alignedX) * progress;
    const nextY = alignedY + (to[index][1] - toCenter[1] - alignedY) * progress;
    return [
      centerX + nextX * remainingCos - nextY * remainingSin,
      centerY + nextX * remainingSin + nextY * remainingCos,
    ];
  }) as Quad;
}

/** `image` places the crop inside the painting's box, which clips it to the painting. */
export type RevealGeometry = {
  from: Quad;
  to: Quad;
  width: number;
  height: number;
  image: { left: number; top: number; width: number; height: number };
};

/** `turns` are clockwise quarter turns from the view to the photo: a photo taken with the phone turned is shown turned back. */
export function revealGeometry(
  painting: PreparedPainting,
  view: FrameSize,
  fit: "cover" | "contain",
  insets = { top: 0, bottom: 0 },
  turns = 0,
): RevealGeometry | null {
  const { photoSize: photo, contentBounds: bounds, cropSize } = painting;
  if (
    ![photo.width, photo.height, view.width, view.height, bounds.width, bounds.height, cropSize].every(
      (n) => Number.isFinite(n) && n > 0,
    )
    || bounds.x < 0
    || bounds.y < 0
    || bounds.x + bounds.width > cropSize
    || bounds.y + bounds.height > cropSize
  ) {
    return null;
  }
  const from = photoCorners(
    turnCorners(painting.corners, -turns),
    turns % 2 ? { width: photo.height, height: photo.width } : photo,
    view,
    fit,
  );
  const { to, width, height, scale } = liftedPlacement(bounds, view, insets);
  if (!perspectiveMatrix(width, height, from) || !perspectiveMatrix(width, height, to)) {
    return null;
  }
  return {
    from,
    to,
    width,
    height,
    image: { left: -bounds.x * scale, top: -bounds.y * scale, width: cropSize * scale, height: cropSize * scale },
  };
}

/** Where corners given as fractions of a photograph land in a view showing that photograph centered. */
export function photoCorners(corners: Quad, photo: FrameSize, view: FrameSize, fit: "cover" | "contain"): Quad {
  const scale = (fit === "cover" ? Math.max : Math.min)(view.width / photo.width, view.height / photo.height);
  return corners.map(([x, y]) => [
    x * photo.width * scale + (view.width - photo.width * scale) / 2,
    y * photo.height * scale + (view.height - photo.height * scale) / 2,
  ]) as Quad;
}

/** Where a lifted painting comes to rest: upright and centered between the insets. */
export function liftedPlacement(
  content: { width: number; height: number },
  view: FrameSize,
  insets = { top: 0, bottom: 0 },
) {
  const availableHeight = view.height - insets.top - insets.bottom;
  const scale = Math.min(
    (view.width - 48) / content.width,
    Math.min(view.height * 0.6, availableHeight) / content.height,
  );
  const width = content.width * scale;
  const height = content.height * scale;
  const left = (view.width - width) / 2;
  const top = insets.top + (availableHeight - height) / 2;
  const to: Quad = [
    [left, top],
    [left + width, top],
    [left + width, top + height],
    [left, top + height],
  ];
  return { to, width, height, scale };
}
