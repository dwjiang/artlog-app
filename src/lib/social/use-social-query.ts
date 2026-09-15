import { useQueries, type RequestForQueries } from 'convex/react';
import { getFunctionName, makeFunctionReference, type FunctionArgs, type FunctionReference, type FunctionReturnType } from 'convex/server';
import { useMemo, useState } from 'react';
import { readCursorPages, type CursorPage } from './cursor-pages';
import { useQueryRefresh } from './use-query-refresh';

type Query = FunctionReference<'query', 'public'>;

export function useSocialQuery<Q extends Query>(query: Q, args: FunctionArgs<Q> | 'skip', scope: string) {
  const retry = useQueryRefresh(query, args, scope);
  const name = getFunctionName(query), serialized = JSON.stringify(args);
  const key = `${scope}:${name}:${serialized}`;
  const enabled = args !== 'skip' && !retry.refreshing;
  const requests = useMemo(() => enabled ? { [key]: { query: makeFunctionReference<'query'>(name), args: JSON.parse(serialized) } } : {},
    [enabled, key, name, serialized]);
  const results = useQueries(requests);
  // A delivered live result outranks a stale refresh failure; `null` is a valid result, so `??` cannot decide this.
  const live: FunctionReturnType<Q> | Error | undefined = results[key];
  const result = enabled ? live !== undefined ? live : retry.error : undefined;
  return { data: result instanceof Error ? undefined : result, error: result instanceof Error ? result : undefined,
    loading: args !== 'skip' && (retry.refreshing || result === undefined), refresh: retry.refresh };
}

export function useCursorPages<Q extends Query, T>(query: Q, args: Omit<FunctionArgs<Q>, 'cursor' | 'limit'> | 'skip',
  scope: string, select: (result: FunctionReturnType<Q>) => CursorPage<T>, identify: (item: T) => string) {
  const name = getFunctionName(query), serialized = JSON.stringify(args);
  const key = `${scope}:${name}:${serialized}`;
  const [state, setState] = useState({ key, cursors: [null] as (string | null)[] });
  const current = state.key === key ? state : { key, cursors: [null] };
  if (state.key !== key) setState(current);
  const retry = useQueryRefresh(query, args === 'skip' ? 'skip' : { ...args, cursor: null, limit: 10 } as FunctionArgs<Q>, scope);
  const enabled = args !== 'skip' && !retry.refreshing;
  const queries = useMemo(() => {
    const requests: RequestForQueries = {};
    if (enabled) current.cursors.forEach((cursor, index) => {
      requests[`${key}:${index}:${cursor}`] = { query: makeFunctionReference<'query'>(name), args: { ...JSON.parse(serialized), cursor, limit: 10 } };
    });
    return requests;
  }, [enabled, key, name, serialized, current.cursors]);
  const results = useQueries(queries);
  const pages = readCursorPages(current.cursors,
    current.cursors.map((cursor, index) => {
      const live = results[`${key}:${index}:${cursor}`];
      return enabled ? live !== undefined ? live : retry.error : undefined;
    }), select, identify);
  if (enabled && pages.validLength < current.cursors.length) {
    setState({ ...current, cursors: current.cursors.slice(0, pages.validLength) });
  }
  return { ...pages, refreshing: retry.refreshing, loading: args !== 'skip' && (pages.loading || retry.refreshing),
    refresh: () => { setState({ key, cursors: [null] }); retry.refresh(); },
    loadMore: () => {
      if (enabled && pages.canLoadMore) setState((previous) => previous.key === key && !previous.cursors.includes(pages.next!)
        ? { ...previous, cursors: [...previous.cursors, pages.next!] } : previous);
    } };
}
