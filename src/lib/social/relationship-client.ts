import { ConvexHttpClient } from "convex/browser";
import { fetch as expoFetch } from "expo/fetch";

/** Uses the captured token; account-bound writes must also validate their captured scope on the server. */
export function relationshipClient(token: string, signal?: AbortSignal) {
  return new ConvexHttpClient(process.env.EXPO_PUBLIC_CONVEX_URL!, {
    auth: token,
    logger: false,
    fetch: (input, options) => expoFetch(input, { ...options, signal }),
  });
}
