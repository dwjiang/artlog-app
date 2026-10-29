import { applyHomography, solveHomography, type Point } from "@/shared/orb/homography";

import type { CropContentBounds } from "../../../modules/vision-rect/src";
import { isUsableQuad } from "./rectangle";
import type { Quad } from "./stages";

/** Normalized distance a snapped corner may overshoot the photo and still be clamped onto its edge. */
export const SNAP_EDGE_TOLERANCE = 0.01;

export type SnapInput = {
  /** The reference's letterboxed `inputSize` square as the match verifier projected it into the crop, in crop pixels. */
  referenceCorners: number[][];
  /** The catalogue image's size at any scale; only its aspect ratio is used. */
  referenceSize: { width: number; height: number };
  /** Where the identified crop sits in the photo, normalized. */
  cropCorners: Quad;
  /** Where the crop's content sits in its letterboxed square. */
  contentBounds: CropContentBounds;
  inputSize: number;
};

const unitSquare: Point[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

/**
 * Where the matched catalogue image lies in the photo: the painting's own edges, whatever the crop that identified it
 * kept or cut. Null when the painting runs off the photo or the projection is not a usable quad.
 */
export function snapToReference({
  referenceCorners,
  referenceSize,
  cropCorners,
  contentBounds,
  inputSize: size,
}: SnapInput): Quad | null {
  const { width, height } = referenceSize;
  if (referenceCorners.length !== 4 || !(width > 0) || !(height > 0)) return null;
  const toCrop = solveHomography(
    unitSquare.map(([x, y]) => [x * size, y * size]),
    referenceCorners.map(([x, y]) => [x, y]),
  );
  const toPhoto = solveHomography(unitSquare, cropCorners);
  if (!toCrop || !toPhoto) return null;
  // The reference was letterboxed like the crop: scaled to fit the square and centered on the padded axis.
  const scale = size / Math.max(width, height);
  const left = (size - width * scale) / 2;
  const top = (size - height * scale) / 2;
  const snapped = unitSquare.map(([x, y]) => {
    const [cropX, cropY] = applyHomography(toCrop, left + x * width * scale, top + y * height * scale);
    const [photoX, photoY] = applyHomography(
      toPhoto,
      (cropX - contentBounds.x) / contentBounds.width,
      (cropY - contentBounds.y) / contentBounds.height,
    );
    return [clampToPhoto(photoX), clampToPhoto(photoY)];
  }) as Quad;
  return isUsableQuad(snapped) ? snapped : null;
}

function clampToPhoto(value: number): number {
  return value >= -SNAP_EDGE_TOLERANCE && value <= 1 + SNAP_EDGE_TOLERANCE ? Math.min(Math.max(value, 0), 1) : NaN;
}
