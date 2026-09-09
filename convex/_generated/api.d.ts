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
import type * as devices from "../devices.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as identify from "../identify.js";
import type * as ingest from "../ingest.js";
import type * as lib_appAttest from "../lib/appAttest.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_calibrator_calibrate from "../lib/calibrator/calibrate.js";
import type * as lib_calibrator_features from "../lib/calibrator/features.js";
import type * as lib_calibrator_index from "../lib/calibrator/index.js";
import type * as lib_calibrator_weights from "../lib/calibrator/weights.js";
import type * as lib_flags from "../lib/flags.js";
import type * as lib_identifyPipeline from "../lib/identifyPipeline.js";
import type * as lib_modelVersion from "../lib/modelVersion.js";
import type * as lib_orb_features from "../lib/orb/features.js";
import type * as lib_orb_hamming from "../lib/orb/hamming.js";
import type * as lib_orb_homography from "../lib/orb/homography.js";
import type * as lib_orb_index from "../lib/orb/index.js";
import type * as lib_orb_match from "../lib/orb/match.js";
import type * as lib_orb_testFixtures from "../lib/orb/testFixtures.js";
import type * as lib_orb_verify from "../lib/orb/verify.js";
import type * as lib_placements from "../lib/placements.js";
import type * as lib_rateLimits from "../lib/rateLimits.js";
import type * as lib_spend from "../lib/spend.js";
import type * as lib_testFactories from "../lib/testFactories.js";
import type * as lib_validators from "../lib/validators.js";
import type * as scans from "../scans.js";
import type * as spend from "../spend.js";
import type * as venueTable from "../venueTable.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  appAttestNode: typeof appAttestNode;
  auth: typeof auth;
  devices: typeof devices;
  health: typeof health;
  http: typeof http;
  identify: typeof identify;
  ingest: typeof ingest;
  "lib/appAttest": typeof lib_appAttest;
  "lib/auth": typeof lib_auth;
  "lib/calibrator/calibrate": typeof lib_calibrator_calibrate;
  "lib/calibrator/features": typeof lib_calibrator_features;
  "lib/calibrator/index": typeof lib_calibrator_index;
  "lib/calibrator/weights": typeof lib_calibrator_weights;
  "lib/flags": typeof lib_flags;
  "lib/identifyPipeline": typeof lib_identifyPipeline;
  "lib/modelVersion": typeof lib_modelVersion;
  "lib/orb/features": typeof lib_orb_features;
  "lib/orb/hamming": typeof lib_orb_hamming;
  "lib/orb/homography": typeof lib_orb_homography;
  "lib/orb/index": typeof lib_orb_index;
  "lib/orb/match": typeof lib_orb_match;
  "lib/orb/testFixtures": typeof lib_orb_testFixtures;
  "lib/orb/verify": typeof lib_orb_verify;
  "lib/placements": typeof lib_placements;
  "lib/rateLimits": typeof lib_rateLimits;
  "lib/spend": typeof lib_spend;
  "lib/testFactories": typeof lib_testFactories;
  "lib/validators": typeof lib_validators;
  scans: typeof scans;
  spend: typeof spend;
  venueTable: typeof venueTable;
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
