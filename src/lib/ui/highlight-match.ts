import { normalizeSearch } from "@/shared/journal/limits";

export type MatchPart = { text: string; match: boolean };

const WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu;

/** Splits `text` so the typed prefix of each word that starts with a query word can be emphasized. */
export function highlightMatch(text: string, query: string): MatchPart[] {
  const terms = normalizeSearch(query).match(/[\p{L}\p{N}]+/gu) ?? [];
  const parts: MatchPart[] = [];
  let cursor = 0;
  for (const word of terms.length > 0 ? text.matchAll(WORD) : []) {
    const normalized = normalizeSearch(word[0]);
    const term = terms.filter((candidate) => normalized.startsWith(candidate)).sort((a, b) => b.length - a.length)[0];
    if (!term) continue;
    let end = 1;
    while (normalizeSearch(word[0].slice(0, end)).length < term.length) end++;
    while (end < word[0].length && /\p{M}/u.test(word[0][end])) end++;
    if (word.index > cursor) parts.push({ text: text.slice(cursor, word.index), match: false });
    parts.push({ text: word[0].slice(0, end), match: true });
    cursor = word.index + end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
  return parts;
}
