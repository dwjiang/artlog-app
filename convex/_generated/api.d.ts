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
import type * as lib_appAttest from "../lib/appAttest.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_flags from "../lib/flags.js";
import type * as lib_placements from "../lib/placements.js";
import type * as lib_rateLimits from "../lib/rateLimits.js";
import type * as lib_spend from "../lib/spend.js";
import type * as lib_validators from "../lib/validators.js";
import type * as spend from "../spend.js";

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
  "lib/appAttest": typeof lib_appAttest;
  "lib/auth": typeof lib_auth;
  "lib/flags": typeof lib_flags;
  "lib/placements": typeof lib_placements;
  "lib/rateLimits": typeof lib_rateLimits;
  "lib/spend": typeof lib_spend;
  "lib/validators": typeof lib_validators;
  spend: typeof spend;
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
