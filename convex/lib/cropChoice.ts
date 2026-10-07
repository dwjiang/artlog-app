/** A nested crop's closest artwork must be at least this similar before the crop replaces the outer boundary. */
export const NESTED_CROP_MIN_SIMILARITY = 0.65;
/** How much closer a nested crop's best match must be than the outer boundary's. */
export const NESTED_CROP_MIN_GAIN = 0.1;

/**
 * Picks the crop to identify from each crop's best index similarity, the outer boundary first. A nested crop
 * wins only when it clearly matches an artwork better, so details inside an unknown painting keep the outer crop.
 */
export function bestCropIndex(similarities: readonly number[]): number {
  let best = 0;
  for (let index = 1; index < similarities.length; index++) {
    if (similarities[index] > similarities[best]) best = index;
  }
  const clearlyBetter =
    similarities[best] >= NESTED_CROP_MIN_SIMILARITY && similarities[best] - similarities[0] >= NESTED_CROP_MIN_GAIN;
  return clearlyBetter ? best : 0;
}

/** Four corners inside the photo, each an x and y normalized to its size. */
export function isNormalizedQuad(corners: readonly (readonly number[])[]): boolean {
  return (
    corners.length === 4
    && corners.every((corner) => corner.length === 2 && corner.every((value) => value >= 0 && value <= 1))
  );
}
