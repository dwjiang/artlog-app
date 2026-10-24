import { useQueries, type RequestForQueries } from "convex/react";
import {
  getFunctionName,
  makeFunctionReference,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
} from "convex/server";
import { useEffect, useMemo, useState } from "react";

import { reportError } from "@/lib/observability";

import { readCursorPages, type CursorPage } from "./cursor-pages";
import { useQueryBatchRefresh, useQueryRefresh } from "./use-query-refresh";

type Query = FunctionReference<"query", "public">;

export function useSocialQuery<Q extends Query>(query: Q, args: FunctionArgs<Q> | "skip", scope: string) {
  const result = useBatchedSocialQuery(query, args === "skip" ? [] : [args], scope);
  return { ...result, data: result.data?.[0] };
}

/** Keeps a set of bounded reads subscribed and retries them as one screen's result. */
export function useBatchedSocialQuery<Q extends Query>(query: Q, args: FunctionArgs<Q>[], scope: string) {
  const retry = useQueryBatchRefresh(query, args, scope);
  const name = getFunctionName(query);
  const serialized = JSON.stringify(args);
  const key = `${scope}:${name}:${serialized}`;
  const enabled = args.length > 0 && !retry.refreshing;
  const requests = useMemo(
    () =>
      enabled
        ? Object.fromEntries(
            (JSON.parse(serialized) as FunctionArgs<Q>[]).map((batch, index) => [
              `${key}:${index}`,
              { query: makeFunctionReference<"query">(name), args: batch },
            ]),
          )
        : {},
    [enabled, key, name, serialized],
  );
  const results = useQueries(requests);
  // A delivered live result outranks a stale refresh failure; `null` is a valid result, so `??` cannot decide this.
  const live: (FunctionReturnType<Q> | Error | undefined)[] = args.map((_, index) => results[`${key}:${index}`]);
  const failure = live.find((result): result is Error => result instanceof Error);
  const complete = live.every((result) => result !== undefined);
  const result = enabled ? (failure ?? (complete ? (live as FunctionReturnType<Q>[]) : retry.error)) : undefined;
  useEffect(() => {
    if (result instanceof Error) reportError(result, `social.query.${name}`);
  }, [result, name]);
  const data = args.length === 0 ? [] : result instanceof Error ? undefined : result;
  // A refresh drops the live subscription, so the last result stays on screen until the new subscription answers.
  const [held, setHeld] = useState<{ key: string; data: FunctionReturnType<Q>[] }>();
  const stale = held !== undefined && (held.key !== key || args.length === 0 || result !== undefined);
  if (stale) setHeld(undefined);
  const holding = held && !stale ? held : undefined;
  return {
    data: holding ? holding.data : data,
    error: result instanceof Error ? result : undefined,
    loading: args.length > 0 && (retry.refreshing || result === undefined),
    refreshing: retry.refreshing || holding !== undefined,
    refresh: () => {
      if (!retry.refreshing && data !== undefined) setHeld({ key, data });
      retry.refresh();
    },
  };
}

export function useCursorPages<Q extends Query, T>(
  query: Q,
  args: Omit<FunctionArgs<Q>, "cursor" | "limit"> | "skip",
  scope: string,
  select: (result: FunctionReturnType<Q>) => CursorPage<T>,
  identify: (item: T) => string,
  // A read started before the session allows it can fail because it was not allowed; it reports only once allowed.
  { report = true }: { report?: boolean } = {},
) {
  const name = getFunctionName(query);
  const serialized = JSON.stringify(args);
  const key = `${scope}:${name}:${serialized}`;
  const [state, setState] = useState({
    key,
    cursors: [null] as (string | null)[],
  });
  const current = state.key === key ? state : { key, cursors: [null] };
  if (state.key !== key) setState(current);
  const retry = useQueryRefresh(
    query,
    args === "skip" ? "skip" : ({ ...args, cursor: null, limit: 10 } as FunctionArgs<Q>),
    scope,
  );
  const enabled = args !== "skip" && !retry.refreshing;
  const queries = useMemo(() => {
    const requests: RequestForQueries = {};
    if (enabled) {
      current.cursors.forEach((cursor, index) => {
        requests[`${key}:${index}:${cursor}`] = {
          query: makeFunctionReference<"query">(name),
          args: { ...JSON.parse(serialized), cursor, limit: 10 },
        };
      });
    }
    return requests;
  }, [enabled, key, name, serialized, current.cursors]);
  const results = useQueries(queries);
  const live = readCursorPages(
    current.cursors,
    current.cursors.map((cursor, index) => {
      const result = results[`${key}:${index}:${cursor}`];
      return enabled ? (result !== undefined ? result : retry.error) : undefined;
    }),
    select,
    identify,
  );
  if (enabled && live.validLength < current.cursors.length) {
    setState({
      ...current,
      cursors: current.cursors.slice(0, live.validLength),
    });
  }
  // A refresh drops the live subscription so it resubscribes fresh; the pages delivered before it stay on screen
  // until the new subscription answers, so a pull-to-refresh never blanks the list.
  const [held, setHeld] = useState<{ key: string; pages: typeof live }>();
  const stale =
    held !== undefined && (held.key !== key || args === "skip" || live.first !== undefined || live.error !== undefined);
  if (stale) setHeld(undefined);
  const holding = held && !stale ? held.pages : undefined;
  const pages = holding ? { ...live, items: holding.items, first: holding.first } : live;
  const refreshing = retry.refreshing || holding !== undefined;
  useEffect(() => {
    if (pages.error && report) reportError(pages.error, `social.query.${name}`);
  }, [pages.error, name, report]);
  return {
    ...pages,
    refreshing,
    loading: args !== "skip" && (pages.loading || refreshing),
    refresh: () => {
      if (!refreshing && live.first !== undefined) {
        setHeld({ key, pages: live });
      }
      setState({ key, cursors: [null] });
      retry.refresh();
    },
    loadMore: () => {
      if (enabled && pages.canLoadMore) {
        setState((previous) =>
          previous.key === key && !previous.cursors.includes(pages.next!)
            ? { ...previous, cursors: [...previous.cursors, pages.next!] }
            : previous,
        );
      }
    },
  };
}
