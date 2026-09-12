import type { TavilyResult, TavilySearchResponse } from './tavily';
import { artistMentioned } from './textMatch';
import type { RightNowCard } from './validators';
import { hostAllowed } from './venueFetch';

// Acceptance boundary from decision 007 §1: retrieval cutoff, publication window, eligible article
// pages, and a complete source sentence with an explicit recent event date. Paraphrases are
// refused: matching names and numbers cannot establish what happened or preserve negation.
export const MIN_SCORE = 0.6;
export const WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
export const MAX_CHARS = 200;
const MIN_CONTENT_CHARS = 80;

const ABSTENTION = /\b(?:no (?:direct |specific |recent |current )?(?:information|news|mention|results?|data)|not mentioned|does not mention|do not mention|(?:is|are|was) not (?:mentioned|available|found|provided)|(?:couldn't|could not|cannot|can't|unable to) (?:find|locate|identify)|based on the provided|provided (?:data|sources|search results|information)|there (?:is|are) no\b|nothing (?:in|from) the (?:provided|available))/i;
const LISTING_PATH = /(?:^|\/)(?:category|categories|tag|tags|topic|topics|section|sections|spotlight|search|shop|store|products?|videos?|archive|archives|author|authors|page\/\d+)(?:\/|$)/i;
const LISTING_HOST = /^(?:shop|store|search)\./i;
const BOILERPLATE = /(?:^|\n)\s*#{1,6}\s*(?:more|most viewed|related|explore more|read more)\b[\s\S]*$|\b(?:more like this|most viewed|explore more on these topics|related (?:articles|stories|content)|read more)\b[\s\S]*$/i;
const SENTENCE_GUARD = /(?:\b[A-Z]|\b(?:Mr|Mrs|Ms|Dr|St|Mt|Jr|Sr|Prof|No|vs|Inc|Ltd|Co|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)|\b(?:[A-Z]\.)+[A-Z])\.$/;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = '(?<month>January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\\.?';
const DAY = '(?<day>\\d{1,2})(?:st|nd|rd|th)?';
const YEAR = '(?<year>\\d{4})';
const EVENT_DATE_PATTERNS = [
  new RegExp(`\\b${MONTH}\\s+${DAY},?\\s+${YEAR}\\b`, 'gi'),
  new RegExp(`\\b${DAY}\\s+${MONTH},?\\s+${YEAR}\\b`, 'gi'),
  /\b(?<year>\d{4})-(?<monthNumber>\d{2})-(?<day>\d{2})\b/g,
];
const EVENT = /\b(?:exhibitions?|shows?|on view|returns? to view|opens?|openings?|opened|unveils?|unveiled|announces?|announced|died|death|passed away)\b/i;
const QUALIFICATION = /\b(?:updates?|correction|corrected|retract(?:ed|ion)|cancel(?:l)?(?:ed|ation)|postpon(?:ed|ement)|reschedul(?:ed|ing)|den(?:ies|ied|ial)|false|untrue|unconfirmed|provisional|tentative|subject to change|however|but|instead|no|not|never)\b|n['’]t\b/i;

export function sentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const parts: string[] = [];
  let start = 0;
  for (const boundary of normalized.matchAll(/[.!?](?:["”’])?\s+/g)) {
    const prefix = normalized.slice(start, boundary.index + 1);
    if (SENTENCE_GUARD.test(prefix)) continue;
    parts.push(normalized.slice(start, boundary.index + boundary[0].length).trim());
    start = boundary.index + boundary[0].length;
  }
  if (normalized.slice(start).trim()) parts.push(normalized.slice(start).trim());
  return parts;
}

export function firstSentence(text: string): string {
  return sentences(text)[0] ?? '';
}

export function isAbstention(answer: string): boolean {
  return ABSTENTION.test(answer);
}

export function isListingUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return true;
  }
  return LISTING_HOST.test(url.hostname) || LISTING_PATH.test(url.pathname) || url.searchParams.has('page');
}

export function publishedAt(value: string | undefined): number | null {
  if (!value) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

// Keep snippet and paragraph boundaries: text on opposite sides of an omission is not a sentence.
function sourceSentences(content: string): string[] {
  return content.replace(BOILERPLATE, '').split('[...]').flatMap((segment) => segment.split(/\n+/))
    .flatMap((paragraph) => sentences(paragraph.replace(/^\s*#{1,6}\s+/, '')));
}

function normalizedSentence(text: string): string {
  return text.normalize('NFC').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
}

// An exact quote can still be retracted elsewhere in the snippet. Without semantic adjudication,
// conservatively suppress surrounding qualification signals, even when they may be unrelated.
function hasOmittedQualification(claim: string, context: string[]): boolean {
  const normalized = normalizedSentence(claim);
  return context.some((sentence) => normalizedSentence(sentence) !== normalized && QUALIFICATION.test(sentence));
}

function hasCurrentEventDate(sentence: string, now: number): boolean {
  if (!EVENT.test(sentence)) return false;
  return EVENT_DATE_PATTERNS.some((pattern) => [...sentence.matchAll(pattern)].some((match) => {
    const { year, month, monthNumber, day } = match.groups!;
    const monthIndex = month ? MONTHS.indexOf(month.slice(0, 3).toLowerCase()) : Number(monthNumber) - 1;
    const at = Date.UTC(Number(year), monthIndex, Number(day));
    const date = new Date(at);
    if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== monthIndex || date.getUTCDate() !== Number(day)) return false;
    return at >= now - WINDOW_MS && at <= now + WINDOW_MS;
  }));
}

function claimSupported(claim: string, artist: string, source: TavilyResult, now: number): boolean {
  if (claim.length > MAX_CHARS || !/[.!?]["”’]?$/.test(claim) || !artistMentioned(claim, artist)) return false;
  if (source.content.trim().length < MIN_CONTENT_CHARS || !hasCurrentEventDate(claim, now)) return false;
  const context = sourceSentences(source.content);
  return !hasOmittedQualification(claim, [source.title, ...context]) &&
    context.some((sentence) => normalizedSentence(sentence) === normalizedSentence(claim));
}

export type AcceptOptions = { artist: string; domains: string[]; now: number };

export function eligibleResults(results: TavilyResult[], options: Pick<AcceptOptions, 'domains' | 'now'>): (TavilyResult & { publishedAt: number })[] {
  return results.flatMap((result) => {
    let url: URL;
    try {
      url = new URL(result.url);
    } catch {
      return [];
    }
    const at = publishedAt(result.publishedDate);
    if (result.score < MIN_SCORE || url.protocol !== 'https:' || !hostAllowed(url, options.domains) || isListingUrl(result.url)) return [];
    if (at === null || at > options.now || at < options.now - WINDOW_MS) return [];
    return [{ ...result, publishedAt: at }];
  }).sort((a, b) => b.score - a.score);
}

export function acceptRightNow(response: TavilySearchResponse, options: AcceptOptions): RightNowCard | null {
  const answer = response.answer?.trim();
  if (!answer || isAbstention(answer)) return null;
  const claim = firstSentence(answer);
  if (!claim || !artistMentioned(claim, options.artist) || hasOmittedQualification(claim, sentences(answer))) return null;
  for (const result of eligibleResults(response.results, options)) {
    if (!claimSupported(claim, options.artist, result, options.now)) continue;
    return { text: claim, sourceUrl: result.url, sourceLabel: new URL(result.url).hostname.replace(/^www\./, '') };
  }
  return null;
}
