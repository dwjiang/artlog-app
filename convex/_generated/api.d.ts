/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as appAttestNode from "../appAttestNode.js";
import type * as auth from "../auth.js";
import type * as corrections from "../corrections.js";
import type * as devices from "../devices.js";
import type * as docent from "../docent.js";
import type * as enrich from "../enrich.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as identify from "../identify.js";
import type * as ingest from "../ingest.js";
import type * as label from "../label.js";
import type * as lib_appAttest from "../lib/appAttest.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_calibrator_calibrate from "../lib/calibrator/calibrate.js";
import type * as lib_calibrator_features from "../lib/calibrator/features.js";
import type * as lib_calibrator_index from "../lib/calibrator/index.js";
import type * as lib_calibrator_weights from "../lib/calibrator/weights.js";
import type * as lib_collectionSiteProbe from "../lib/collectionSiteProbe.js";
import type * as lib_docentPrompts from "../lib/docentPrompts.js";
import type * as lib_docentSources from "../lib/docentSources.js";
import type * as lib_docentValidator from "../lib/docentValidator.js";
import type * as lib_flags from "../lib/flags.js";
import type * as lib_identifyPipeline from "../lib/identifyPipeline.js";
import type * as lib_labelFixtures from "../lib/labelFixtures.js";
import type * as lib_labelPrompt from "../lib/labelPrompt.js";
import type * as lib_labelVerify from "../lib/labelVerify.js";
import type * as lib_modelVersion from "../lib/modelVersion.js";
import type * as lib_moderation from "../lib/moderation.js";
import type * as lib_orb_features from "../lib/orb/features.js";
import type * as lib_orb_hamming from "../lib/orb/hamming.js";
import type * as lib_orb_homography from "../lib/orb/homography.js";
import type * as lib_orb_index from "../lib/orb/index.js";
import type * as lib_orb_match from "../lib/orb/match.js";
import type * as lib_orb_testFixtures from "../lib/orb/testFixtures.js";
import type * as lib_orb_verify from "../lib/orb/verify.js";
import type * as lib_pageExtract from "../lib/pageExtract.js";
import type * as lib_placements from "../lib/placements.js";
import type * as lib_plausibility from "../lib/plausibility.js";
import type * as lib_politeFetch from "../lib/politeFetch.js";
import type * as lib_rateLimits from "../lib/rateLimits.js";
import type * as lib_regions from "../lib/regions.js";
import type * as lib_rightNowAccept from "../lib/rightNowAccept.js";
import type * as lib_rightNowFixtures from "../lib/rightNowFixtures.js";
import type * as lib_sourceScores from "../lib/sourceScores.js";
import type * as lib_spend from "../lib/spend.js";
import type * as lib_tavily from "../lib/tavily.js";
import type * as lib_tavilySpend from "../lib/tavilySpend.js";
import type * as lib_testFactories from "../lib/testFactories.js";
import type * as lib_textMatch from "../lib/textMatch.js";
import type * as lib_tokenFactory from "../lib/tokenFactory.js";
import type * as lib_validators from "../lib/validators.js";
import type * as lib_venueFetch from "../lib/venueFetch.js";
import type * as lib_venueOptOut from "../lib/venueOptOut.js";
import type * as lib_wikidata from "../lib/wikidata.js";
import type * as museums from "../museums.js";
import type * as review from "../review.js";
import type * as rightNow from "../rightNow.js";
import type * as scans from "../scans.js";
import type * as spend from "../spend.js";
import type * as venueTable from "../venueTable.js";
import type * as visits from "../visits.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  appAttestNode: typeof appAttestNode;
  auth: typeof auth;
  corrections: typeof corrections;
  devices: typeof devices;
  docent: typeof docent;
  enrich: typeof enrich;
  health: typeof health;
  http: typeof http;
  identify: typeof identify;
  ingest: typeof ingest;
  label: typeof label;
  "lib/appAttest": typeof lib_appAttest;
  "lib/auth": typeof lib_auth;
  "lib/calibrator/calibrate": typeof lib_calibrator_calibrate;
  "lib/calibrator/features": typeof lib_calibrator_features;
  "lib/calibrator/index": typeof lib_calibrator_index;
  "lib/calibrator/weights": typeof lib_calibrator_weights;
  "lib/collectionSiteProbe": typeof lib_collectionSiteProbe;
  "lib/docentPrompts": typeof lib_docentPrompts;
  "lib/docentSources": typeof lib_docentSources;
  "lib/docentValidator": typeof lib_docentValidator;
  "lib/flags": typeof lib_flags;
  "lib/identifyPipeline": typeof lib_identifyPipeline;
  "lib/labelFixtures": typeof lib_labelFixtures;
  "lib/labelPrompt": typeof lib_labelPrompt;
  "lib/labelVerify": typeof lib_labelVerify;
  "lib/modelVersion": typeof lib_modelVersion;
  "lib/moderation": typeof lib_moderation;
  "lib/orb/features": typeof lib_orb_features;
  "lib/orb/hamming": typeof lib_orb_hamming;
  "lib/orb/homography": typeof lib_orb_homography;
  "lib/orb/index": typeof lib_orb_index;
  "lib/orb/match": typeof lib_orb_match;
  "lib/orb/testFixtures": typeof lib_orb_testFixtures;
  "lib/orb/verify": typeof lib_orb_verify;
  "lib/pageExtract": typeof lib_pageExtract;
  "lib/placements": typeof lib_placements;
  "lib/plausibility": typeof lib_plausibility;
  "lib/politeFetch": typeof lib_politeFetch;
  "lib/rateLimits": typeof lib_rateLimits;
  "lib/regions": typeof lib_regions;
  "lib/rightNowAccept": typeof lib_rightNowAccept;
  "lib/rightNowFixtures": typeof lib_rightNowFixtures;
  "lib/sourceScores": typeof lib_sourceScores;
  "lib/spend": typeof lib_spend;
  "lib/tavily": typeof lib_tavily;
  "lib/tavilySpend": typeof lib_tavilySpend;
  "lib/testFactories": typeof lib_testFactories;
  "lib/textMatch": typeof lib_textMatch;
  "lib/tokenFactory": typeof lib_tokenFactory;
  "lib/validators": typeof lib_validators;
  "lib/venueFetch": typeof lib_venueFetch;
  "lib/venueOptOut": typeof lib_venueOptOut;
  "lib/wikidata": typeof lib_wikidata;
  museums: typeof museums;
  review: typeof review;
  rightNow: typeof rightNow;
  scans: typeof scans;
  spend: typeof spend;
  venueTable: typeof venueTable;
  visits: typeof visits;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
