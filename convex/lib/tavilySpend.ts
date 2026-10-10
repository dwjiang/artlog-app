import { ConvexError } from "convex/values";

import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { reportBackendError } from "./observability";
import { reserveSpend } from "./spend";
import {
  extract,
  extractCredits,
  search,
  type ExtractDepth,
  type TavilySearchRequest,
  type TavilySearchResponse,
} from "./tavily";

export const searchWithCredit = (ctx: ActionCtx, request: TavilySearchRequest): Promise<TavilySearchResponse | null> =>
  withCredit(ctx, () => search(request), "search", 1);
export const extractWithCredit = (ctx: ActionCtx, urls: string[], depth: ExtractDepth = "advanced") =>
  withCredit(ctx, () => extract(urls, depth), "extract", extractCredits(urls.length, depth));

// Credits are reserved atomically before dispatch and reconciled from the reported
// usage. Returns null when the cap is reached, the key is missing, or the search fails; the caller
// continues without web evidence.
async function withCredit<T extends { credits?: number }>(
  ctx: ActionCtx,
  run: () => Promise<T>,
  operation: string,
  reserved: number,
): Promise<T | null> {
  let day: string;
  try {
    day = await reserveSpend(ctx, "tavily", reserved);
  } catch (error) {
    if (error instanceof ConvexError && error.data.code === "spend_cap") {
      console.warn("Tavily daily cap reached; skipping web search");
      return null;
    }
    throw error;
  }
  let response: T;
  try {
    response = await run();
  } catch (error) {
    if (error instanceof ConvexError && error.data.code === "search_unconfigured") {
      await ctx.runMutation(internal.spend.reconcile, {
        kind: "tavily",
        day,
        reserved,
        actual: 0,
      });
    }
    // Any other failure keeps the reservation: the provider may have charged the credit.
    await reportBackendError(error, `tavily.${operation}`);
    console.warn(`Tavily ${operation} failed`, error);
    return null;
  }
  if (response.credits !== undefined) {
    await ctx.runMutation(internal.spend.reconcile, {
      kind: "tavily",
      day,
      reserved,
      actual: response.credits,
    });
  }
  return response;
}
