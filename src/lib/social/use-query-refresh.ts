import { useAuthToken } from "@convex-dev/auth/react";
import { ConvexHttpClient } from "convex/browser";
import { getFunctionName, type FunctionArgs, type FunctionReference } from "convex/server";
import { fetch as expoFetch } from "expo/fetch";
import { useEffect, useRef, useState } from "react";

import { captureOwner } from "@/lib/account/owner-store";
import { reportError } from "@/lib/observability";

export function useQueryRefresh<Q extends FunctionReference<"query", "public">>(
  query: Q,
  args: FunctionArgs<Q> | "skip",
  scope: string,
) {
  const token = useAuthToken();
  const key = `${scope}:${getFunctionName(query)}:${JSON.stringify(args)}`;
  const [state, setState] = useState<{
    key: string;
    busy: boolean;
    error?: Error;
  }>({
    key,
    busy: false,
  });
  const request = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
      // An aborted read never reports back, so the key it belonged to must not stay busy if it returns.
      setState((previous) => (previous.busy ? { key: previous.key, busy: false } : previous));
    },
    [key],
  );

  async function refresh() {
    if (args === "skip" || request.current) return;
    const session = captureOwner();
    const controller = new AbortController();
    request.current = controller;
    setState({ key, busy: true });
    // A fresh HTTP read retries query failures even when the live subscription has cached the error.
    const client = new ConvexHttpClient(process.env.EXPO_PUBLIC_CONVEX_URL!, {
      auth: token ?? undefined,
      logger: false,
      fetch: (input, options) => expoFetch(input, { ...options, signal: controller.signal }),
    });
    let error: Error | undefined;
    try {
      await client.query(query, args);
    } catch (cause) {
      if (session.isCurrent() && !controller.signal.aborted) {
        reportError(cause, `social.query.${getFunctionName(query)}`);
      }
      error = cause instanceof Error ? cause : new Error("Couldn’t refresh. Try again.", { cause });
    } finally {
      if (session.isCurrent() && !controller.signal.aborted) {
        request.current = null;
        setState({ key, busy: false, error });
      }
    }
  }
  return {
    refreshing: state.key === key && state.busy,
    error: state.key === key ? state.error : undefined,
    refresh: () => {
      void refresh();
    },
  };
}
