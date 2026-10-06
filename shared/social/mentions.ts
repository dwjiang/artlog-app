import { completeWord, type TagRange } from "./hashtags";
import { isUsername } from "./username";

/** Distinct handles past this many in one text stay plain. */
export const MAX_MENTIONS = 30;
/** Only the first people named in one post or comment hear about it; the rest still link. */
export const MAX_NOTIFIED_MENTIONS = 10;

const HANDLE_CHAR = /[A-Za-z0-9_]/;
// A mention starts at the text's start or after a character that can't continue a word, an email address, a URL path
// or another tag, and the handle must end the word: `a@b.com`, `site.com/@x`, `#a@b` and `@café` stay text.
const MENTION = /(^|[^\p{L}\p{M}\p{N}_/&#@.])@([A-Za-z0-9_]+)(?![\p{L}\p{M}\p{N}_])/gu;
const startsMention = (before: string | undefined) => before === undefined || !/[\p{L}\p{M}\p{N}_/&#@.]/u.test(before);

export type MentionSegment = { text: string; mention?: string };

/** The username a typed handle names, so @Maya and @maya match; null when no username can look like it. */
export function normalizeMention(handle: string): string | null {
  const username = handle.toLowerCase();
  return isUsername(username) ? username : null;
}

/** Splits text into plain runs and @handles; each handle keeps its typed text and carries its username. */
export function mentionSegments(text: string): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(MENTION)) {
    const mention = normalizeMention(match[2]);
    if (!mention) continue;
    const start = match.index + match[1].length;
    const end = start + 1 + match[2].length;
    if (start > last) segments.push({ text: text.slice(last, start) });
    segments.push({ text: text.slice(start, end), mention });
    last = end;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}

/** The distinct usernames a text names, in order of first use. */
export function extractMentions(text: string): string[] {
  const usernames = new Set(mentionSegments(text).flatMap((segment) => (segment.mention ? [segment.mention] : [])));
  return [...usernames].slice(0, MAX_MENTIONS);
}

/** The handle around `cursor` while it is being typed, from its `@` to the word's end; a bare `@` has an empty query. */
export function activeMention(text: string, cursor: number): (TagRange & { query: string }) | null {
  let start = cursor;
  while (start > 0 && HANDLE_CHAR.test(text[start - 1])) start--;
  const at = start - 1;
  if (text[at] !== "@" || !startsMention(text[at - 1])) return null;
  let end = cursor;
  while (end < text.length && HANDLE_CHAR.test(text[end])) end++;
  return { start: at, end, query: text.slice(start, cursor).toLowerCase() };
}

export const completeMention = (text: string, range: TagRange, username: string, maxLength: number) =>
  completeWord(text, range, `@${username}`, maxLength);
