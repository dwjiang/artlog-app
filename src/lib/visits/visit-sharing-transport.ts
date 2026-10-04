import { ConvexHttpClient } from "convex/browser";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { fetch as expoFetch } from "expo/fetch";

import type { RequestContext } from "@/lib/wall/wall-transport";

import { api } from "../../../convex/_generated/api";

export type ShareSelection = FunctionArgs<typeof api.sharedVisits.publish>;
export type ShareState = FunctionReturnType<typeof api.sharedVisits.getState>;
export function createVisitSharingTransport(url: string, fetcher: typeof globalThis.fetch = expoFetch) {
  function client({ token, signal }: RequestContext) {
    return new ConvexHttpClient(url, {
      auth: token,
      logger: false,
      fetch: (input, options) => fetcher(input, { ...options, signal }),
    });
  }
  return {
    getState: (args: FunctionArgs<typeof api.sharedVisits.getState>, context: RequestContext) =>
      client(context).query(api.sharedVisits.getState, args),
    publish: (args: ShareSelection, context: RequestContext) => client(context).action(api.sharedVisits.publish, args),
  };
}
export type VisitSharingTransport = ReturnType<typeof createVisitSharingTransport>;
