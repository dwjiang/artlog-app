import { ConvexError } from "convex/values";

import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { search, type TavilySearchRequest, type TavilySearchResponse } from "./tavily";
import { reportBackendError } from "./observability";

// One credit is reserved atomically before dispatch and reconciled from the reported
// usage. Returns null when the cap is reached, the key is missing, or the search fails; the caller
// continues without web evidence.
export async function searchWithCredit(
  ctx: ActionCtx,
  request: TavilySearchRequest,
): Promise<TavilySearchResponse | null> {
  let day: string;
  try {
    day = await ctx.runMutation(internal.spend.reserve, { kind: "tavily", amount: 1 });
  } catch (error) {
    if (error instanceof ConvexError && error.data.code === "spend_cap") {
      console.warn("Tavily daily cap reached; skipping web search");
      return null;
    }
    throw error;
  }
  let response: TavilySearchResponse;
  try {
    response = await search(request);
  } catch (error) {
    if (error instanceof ConvexError && error.data.code === "search_unconfigured") {
      await ctx.runMutation(internal.spend.reconcile, {
        kind: "tavily",
        day,
        reserved: 1,
        actual: 0,
      });
    }
    // Any other failure keeps the reservation: the provider may have charged the credit.
    await reportBackendError(error, "tavily.search");
    console.warn("Tavily search failed", error);
    return null;
  }
  if (response.credits !== undefined) {
    await ctx.runMutation(internal.spend.reconcile, {
      kind: "tavily",
      day,
      reserved: 1,
      actual: response.credits,
    });
  }
  return response;
}
