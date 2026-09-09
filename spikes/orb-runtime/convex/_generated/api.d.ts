/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as benchHelpers from "../benchHelpers.js";
import type * as lib_orb_features from "../lib/orb/features.js";
import type * as lib_orb_hamming from "../lib/orb/hamming.js";
import type * as lib_orb_homography from "../lib/orb/homography.js";
import type * as lib_orb_index from "../lib/orb/index.js";
import type * as lib_orb_match from "../lib/orb/match.js";
import type * as lib_orb_testFixtures from "../lib/orb/testFixtures.js";
import type * as lib_orb_verify from "../lib/orb/verify.js";
import type * as orbBench from "../orbBench.js";
import type * as orbBenchWasm from "../orbBenchWasm.js";
import type * as wasmMatcher from "../wasmMatcher.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  benchHelpers: typeof benchHelpers;
  "lib/orb/features": typeof lib_orb_features;
  "lib/orb/hamming": typeof lib_orb_hamming;
  "lib/orb/homography": typeof lib_orb_homography;
  "lib/orb/index": typeof lib_orb_index;
  "lib/orb/match": typeof lib_orb_match;
  "lib/orb/testFixtures": typeof lib_orb_testFixtures;
  "lib/orb/verify": typeof lib_orb_verify;
  orbBench: typeof orbBench;
  orbBenchWasm: typeof orbBenchWasm;
  wasmMatcher: typeof wasmMatcher;
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

export declare const components: {};
