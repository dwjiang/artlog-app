import { hashtagSegments } from "./hashtags";
import { mentionSegments } from "./mentions";

export type RichSegment = { text: string; tag?: string; mention?: string };

type Mark = { start: number; end: number; tag?: string; mention?: string };
function marks(segments: readonly RichSegment[]): Mark[] {
  let start = 0;
  const found: Mark[] = [];
  for (const { text, tag, mention } of segments) {
    if (tag || mention) found.push({ start, end: start + text.length, tag, mention });
    start += text.length;
  }
  return found;
}

/** Splits text into plain runs, #tags and @handles. Each is found on the whole text, so its word boundaries hold. */
export function richTextSegments(text: string): RichSegment[] {
  // Neither sign can continue the other's word, so tags and mentions never overlap.
  const found = [...marks(hashtagSegments(text)), ...marks(mentionSegments(text))].sort((a, b) => a.start - b.start);
  const segments: RichSegment[] = [];
  let last = 0;
  for (const { start, end, tag, mention } of found) {
    if (start > last) segments.push({ text: text.slice(last, start) });
    segments.push({ text: text.slice(start, end), ...(tag ? { tag } : { mention }) });
    last = end;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}
