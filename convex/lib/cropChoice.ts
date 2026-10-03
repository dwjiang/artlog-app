// Mac-harness photos (2026-10-03): nested crops of indexed paintings on phone and laptop screens gained 0.12 or
// more, reaching 0.79–0.99; on framed and gallery photos the largest nested win was +0.075 at 0.515.
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
