import type { FrameSize } from "./rectangle";
import type { Quad } from "./stages";

export const wholePhoto: Quad = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

export function validCrop(quad: Quad): boolean {
  return quad.every(([x, y], i) => {
    const b = quad[(i + 1) % 4],
      c = quad[(i + 2) % 4];
    return (
      Number.isFinite(x)
      && Number.isFinite(y)
      && x >= 0
      && x <= 1
      && y >= 0
      && y <= 1
      && (b[0] - x) * (c[1] - b[1]) - (b[1] - y) * (c[0] - b[0]) > 0.002
    );
  });
}

export function moveCropCorner(quad: Quad, index: number, x: number, y: number): Quad {
  const next = quad.map((point, i) =>
    i === index ? [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))] : point,
  ) as Quad;
  return validCrop(next) ? next : quad;
}

export function fitPhoto(photo: FrameSize, frame: FrameSize) {
  const scale = Math.min(frame.width / photo.width, frame.height / photo.height);
  const width = photo.width * scale,
    height = photo.height * scale;
  return {
    width,
    height,
    left: (frame.width - width) / 2,
    top: (frame.height - height) / 2,
  };
}
