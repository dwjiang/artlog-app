import { v } from "convex/values";

export const exhibitionViewingPeriod = v.object({
  startDate: v.union(v.string(), v.null()),
  endDate: v.string(),
});

const verifiedExhibitionFields = {
  title: v.string(),
  sourceUrl: v.string(),
  sourceSha256: v.string(),
  checkedAt: v.number(),
  timeZone: v.string(),
  viewingPeriods: v.array(exhibitionViewingPeriod),
  /** The show page's own link-preview image, hotlinked from the museum's site. */
  imageUrl: v.optional(v.string()),
  /** Image checks are versioned separately from the captured title/date evidence. */
  imageCheckedAt: v.optional(v.number()),
};

export const verifiedExhibition = v.object(verifiedExhibitionFields);

export const exhibitionImport = v.object({ venueKey: v.string(), ...verifiedExhibitionFields });

export const exhibition = v.object({
  museumId: v.id("museums"),
  /** The museum's region when imported, so Explore can read one region by index. */
  region: v.string(),
  titleKey: v.string(),
  finalEndAt: v.number(),
  // The cutoff clears this independently of imageCheckedAt so unavailable images can still retry.
  imagePending: v.optional(v.literal(true)),
  ...verifiedExhibitionFields,
});

export const exhibitionBatchResult = v.object({
  inserted: v.number(),
  updated: v.number(),
  unchanged: v.number(),
});

export const exploreRegion = v.object({ region: v.string(), lat: v.number(), lng: v.number() });

export const exploreRegionCatalog = v.object({
  museums: v.array(
    v.object({
      museumId: v.id("museums"),
      name: v.string(),
      city: v.union(v.string(), v.null()),
      lat: v.number(),
      lng: v.number(),
    }),
  ),
  exhibitions: v.array(
    v.object({
      exhibitionId: v.id("exhibitions"),
      museumId: v.id("museums"),
      title: v.string(),
      sourceUrl: v.string(),
      imageUrl: v.optional(v.string()),
      viewingPeriods: v.array(exhibitionViewingPeriod),
    }),
  ),
});

export const exhibitionExport = v.object({
  exhibitionId: v.id("exhibitions"),
  museumId: v.id("museums"),
  region: v.string(),
  finalEndAt: v.number(),
  ...exhibitionImport.fields,
});
