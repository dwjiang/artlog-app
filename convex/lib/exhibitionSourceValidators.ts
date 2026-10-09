import { v } from "convex/values";

export const exhibitionSourceStatus = v.union(
  v.literal("validated"),
  v.literal("no_listing_found"),
  v.literal("missing_website"),
  v.literal("inaccessible"),
  v.literal("temporary_failure"),
);

export const exhibitionListingUrl = v.object({
  url: v.string(),
  purpose: v.union(v.literal("current"), v.literal("upcoming"), v.literal("combined")),
  discoverySource: v.union(
    v.literal("navigation"),
    v.literal("sitemap"),
    v.literal("prior_research"),
    v.literal("web_search"),
    v.literal("browser"),
    v.literal("homepage"),
  ),
  validatedAt: v.number(),
  evidence: v.string(),
  venueAssociation: v.union(v.literal("venue_specific"), v.literal("shared_with_identity")),
});

export const exhibitionSource = v.object({
  museumId: v.id("museums"),
  websiteSnapshot: v.union(v.string(), v.null()),
  status: exhibitionSourceStatus,
  urls: v.array(exhibitionListingUrl),
  outcomeReason: v.string(),
  checkedAt: v.number(),
});

export const exhibitionSourceBatchResult = v.object({
  inserted: v.number(),
  updated: v.number(),
  unchanged: v.number(),
});
