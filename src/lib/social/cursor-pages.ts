import { isNetworkError } from "@/lib/network-error";

export type CursorPage<T> = {
  page: T[];
  cursor: string | null;
  isDone: boolean;
};

// Only a continuous chain of current cursors may contribute visible content.
export function readCursorPages<T, R>(
  cursors: (string | null)[],
  results: (R | Error | undefined)[],
  select: (result: R) => CursorPage<T>,
  identify: (item: T) => string,
) {
  const items = new Map<string, T>();
  let validLength = 1;
  let last: CursorPage<T> | undefined;
  let first: R | undefined;
  let loading = false;
  let error: Error | undefined;
  for (let index = 0; index < cursors.length; index++) {
    if (index && (!last || last.isDone || last.cursor !== cursors[index])) {
      break;
    }
    validLength = index + 1;
    const result = results[index];
    if (result instanceof Error) {
      error = result;
      break;
    }
    if (result === undefined) {
      loading = true;
      break;
    }
    first ??= result;
    last = select(result);
    for (const item of last.page) {
      if (!items.has(identify(item))) items.set(identify(item), item);
    }
  }
  const done = !loading && !error && last?.isDone === true;
  const next = last?.cursor;
  const canLoadMore = !loading && !error && !done && next != null && !cursors.slice(0, validLength).includes(next);
  // A transport failure does not revoke earlier pages; permission and server failures do.
  const hideLoaded = !!error && !isNetworkError(error);
  return {
    items: hideLoaded ? [] : [...items.values()],
    first: hideLoaded ? undefined : first,
    loading,
    error,
    done,
    next,
    canLoadMore,
    validLength,
  };
}
