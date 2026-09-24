import { ConvexHttpClient } from "convex/browser";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { fetch as expoFetch } from "expo/fetch";
import { api } from "../../../convex/_generated/api";
import type { RequestContext } from "../wall/wall-transport";

export type ShareSelection = FunctionArgs<typeof api.sharedVisits.publish>;
export type ShareState = FunctionReturnType<typeof api.sharedVisits.getState>;
export type SharePreview = FunctionReturnType<typeof api.sharedVisits.preview>;
export type SharedVisit = FunctionReturnType<typeof api.sharedVisits.get>;
export function createVisitSharingTransport(
  url: string,
  fetcher: typeof globalThis.fetch = expoFetch,
) {
  function client({ token, signal }: RequestContext) {
    return new ConvexHttpClient(url, {
      auth: token,
      logger: false,
      fetch: (input, options) => fetcher(input, { ...options, signal }),
    });
  }
  return {
    getState: (
      args: FunctionArgs<typeof api.sharedVisits.getState>,
      context: RequestContext,
    ) => client(context).query(api.sharedVisits.getState, args),
    preview: (args: ShareSelection, context: RequestContext) =>
      client(context).query(api.sharedVisits.preview, args),
    publish: (args: ShareSelection, context: RequestContext) =>
      client(context).mutation(api.sharedVisits.publish, args, {
        skipQueue: true,
      }),
    get: (
      args: FunctionArgs<typeof api.sharedVisits.get>,
      context: RequestContext,
    ) => client(context).query(api.sharedVisits.get, args),
  };
}
export type VisitSharingTransport = ReturnType<
  typeof createVisitSharingTransport
>;
