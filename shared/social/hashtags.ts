export const MAX_POST_TAGS = 30;
export const MAX_TAG_LENGTH = 50;

const TAG_CHAR = /[\p{L}\p{M}\p{N}_]/u;
const TAG_BODY = /^[\p{L}\p{M}\p{N}_]+$/u;
const LETTER = /\p{L}/u;
// A tag starts at the text's start or after a character that can't continue a word: never inside a word, after `/`
// (a URL fragment), after `&` (an HTML entity like `&#39;`) or after another `#`.
const TAG = /(^|[^\p{L}\p{M}\p{N}_/&#])#([\p{L}\p{M}\p{N}_]+)/gu;
const startsTag = (before: string | undefined) => before === undefined || !/[\p{L}\p{M}\p{N}_/&#]/u.test(before);

export type TextSegment = { text: string; tag?: string };
export type TagRange = { start: number; end: number };

/** The start of a tag in stored form, for prefix search; null when no tag can start with `text`. */
export function normalizeTagPrefix(text: string): string | null {
  const prefix = text.normalize("NFC").toLowerCase();
  return TAG_BODY.test(prefix) && prefix.length <= MAX_TAG_LENGTH ? prefix : null;
}

/** The form a tag is stored and matched in, so #Monet and #monet share a page; null when `body` can't be a tag. */
export function normalizeHashtag(body: string): string | null {
  const tag = normalizeTagPrefix(body);
  return tag && LETTER.test(tag) ? tag : null;
}

/** Splits text into plain runs and tags; each tag keeps its typed text and carries its normalized form. */
export function hashtagSegments(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(TAG)) {
    const tag = normalizeHashtag(match[2]);
    if (!tag) continue;
    const start = match.index + match[1].length;
    const end = start + 1 + match[2].length;
    if (start > last) segments.push({ text: text.slice(last, start) });
    segments.push({ text: text.slice(start, end), tag });
    last = end;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}

/** The distinct tags a post is indexed under, in order of first use. */
export function extractHashtags(text: string): string[] {
  const tags = new Set(hashtagSegments(text).flatMap((segment) => (segment.tag ? [segment.tag] : [])));
  return [...tags].slice(0, MAX_POST_TAGS);
}

/** The tag word around `cursor` while it is being typed, from its `#` to the word's end, with the typed part as `query`. */
export function activeHashtag(text: string, cursor: number): (TagRange & { query: string }) | null {
  let start = cursor;
  while (start > 0 && TAG_CHAR.test(text[start - 1])) start--;
  const hash = start - 1;
  if (text[hash] !== "#" || !startsTag(text[hash - 1])) return null;
  let end = cursor;
  while (end < text.length && TAG_CHAR.test(text[end])) end++;
  return { start: hash, end, query: text.slice(start, cursor).normalize("NFC").toLowerCase() };
}

/** Completes a tag and places the cursor after its trailing space; returns null if it would exceed the field limit. */
export function completeHashtag(
  text: string,
  range: TagRange,
  tag: string,
  maxLength: number,
): { text: string; cursor: number } | null {
  const before = `${text.slice(0, range.start)}#${tag}`;
  const after = text.slice(range.end);
  const spaced = after.startsWith(" ") ? after : ` ${after}`;
  const completed = before + spaced;
  return completed.length <= maxLength ? { text: completed, cursor: before.length + 1 } : null;
}
