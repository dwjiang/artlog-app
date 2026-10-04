import { ConvexError } from "convex/values";

import { pagination } from "@/shared/journal/contracts";
import { LIMITS, normalizeSearch } from "@/shared/journal/limits";

export type PageOptions = { cursor?: string | null; limit?: number };
export type Page<T> = { page: T[]; cursor: string | null; isDone: boolean };

export function searchTerm(query = ""): string | null {
  const term = normalizeSearch(query);
  return term.length > LIMITS.searchMax ? null : term;
}

export function matchesSearch(fields: (string | null | undefined)[], term: string): boolean {
  const text = normalizeSearch(fields.filter(Boolean).join(" "));
  return term.split(" ").every((word) => text.includes(word));
}

export function pageRows<T>(rows: T[], key: (row: T) => string, scope: string, options: PageOptions = {}): Page<T> {
  const { numItems, cursor } = pagination(options);
  let after: string | undefined;
  if (cursor) {
    try {
      const decoded = JSON.parse(cursor);
      if (decoded.scope !== scope || typeof decoded.after !== "string") {
        throw new Error();
      }
      after = decoded.after;
    } catch {
      throw new ConvexError({ code: "invalid_pagination" });
    }
  }
  const ordered = rows
    .filter((row) => after === undefined || key(row) < after)
    .sort((a, b) => compareText(key(b), key(a)));
  const page = ordered.slice(0, numItems);
  const isDone = ordered.length <= numItems;
  return {
    page,
    isDone,
    cursor: isDone ? null : JSON.stringify({ scope, after: key(page[page.length - 1]) }),
  };
}

export const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
