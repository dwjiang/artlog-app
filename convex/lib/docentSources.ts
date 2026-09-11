import { ConvexError } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { wikidataScore, type SourceDoc } from './docentPrompts';
import { pageText } from './pageExtract';
import { admissibleDomains, sourceScore } from './sourceScores';
import { searchWithCredit } from './tavilySpend';
import { fetchVenuePage, venueHosts } from './venueFetch';
import {
  entityLabel, getEntities, getEntity, itemValues, monolingualValues, quantityValues, stringValues, yearValues,
  type WikidataEntity,
} from './wikidata';

const MIN_PAGE_CHARS = 80;
const SEARCH_RESULTS = 5;

const SUMMARY_PROPERTIES: { property: string; name: string; kind: 'item' | 'time' | 'string' | 'monolingual' | 'quantity' }[] = [
  { property: 'P1476', name: 'Title', kind: 'monolingual' },
  { property: 'P170', name: 'Creator', kind: 'item' },
  { property: 'P571', name: 'Inception', kind: 'time' },
  { property: 'P186', name: 'Material', kind: 'item' },
  { property: 'P2048', name: 'Height', kind: 'quantity' },
  { property: 'P2049', name: 'Width', kind: 'quantity' },
  { property: 'P135', name: 'Movement', kind: 'item' },
  { property: 'P136', name: 'Genre', kind: 'item' },
  { property: 'P180', name: 'Depicts', kind: 'item' },
  { property: 'P276', name: 'Location', kind: 'item' },
  { property: 'P195', name: 'Collection', kind: 'item' },
  { property: 'P217', name: 'Inventory number', kind: 'string' },
  { property: 'P6216', name: 'Copyright status', kind: 'item' },
];
const UNITS: Record<string, string> = { Q174728: 'cm', Q11573: 'm', Q174789: 'mm', Q218593: 'in' };

export type SourceInput = {
  artwork: Pick<Doc<'artworks'>, 'title' | 'artist' | 'wikidataId'>;
  owner: Pick<Doc<'museums'>, 'name' | 'website' | 'collectionSiteUrl'> | null;
  pageUrl?: string;
};

export type GatheredSources = { sources: SourceDoc[]; failures: number };

function bareHost(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '');
}

export async function wikidataSummary(entity: WikidataEntity): Promise<string> {
  const itemIds = SUMMARY_PROPERTIES.filter(({ kind }) => kind === 'item').flatMap(({ property }) => itemValues(entity, property));
  const labels = itemIds.length ? await getEntities(itemIds, 'labels') : {};
  const lines: string[] = [];
  const label = entityLabel(entity);
  if (label) lines.push(`Label: ${label}`);
  for (const { property, name, kind } of SUMMARY_PROPERTIES) {
    let values: string[] = [];
    if (kind === 'item') values = itemValues(entity, property).flatMap((id) => (labels[id] ? [entityLabel(labels[id]) ?? id] : []));
    else if (kind === 'time') values = yearValues(entity, property).map(String);
    else if (kind === 'string') values = stringValues(entity, property);
    else if (kind === 'monolingual') values = monolingualValues(entity, property);
    else values = quantityValues(entity, property).map(({ amount, unit }) => `${amount}${UNITS[unit] ? ` ${UNITS[unit]}` : ''}`);
    if (values.length) lines.push(`${name}: ${[...new Set(values)].join(', ')}`);
  }
  return lines.join('\n');
}

// Design §4.8: the owner's collection page, Wikidata, and score-filtered search results. Fetch errors
// are counted so the caller can retry later instead of caching an empty sheet.
export async function gatherSources(ctx: ActionCtx, input: SourceInput): Promise<GatheredSources> {
  const sources: SourceDoc[] = [];
  let failures = 0;
  if (input.pageUrl && input.owner) {
    try {
      const page = await fetchVenuePage(input.pageUrl, venueHosts(input.owner));
      const text = pageText(page.html);
      if (text.length >= MIN_PAGE_CHARS) sources.push({ url: page.url, label: input.owner.name, score: 1, text });
    } catch (error) {
      if (!(error instanceof ConvexError && error.data.code === 'qr_host_not_allowed')) failures++;
      console.warn('Owner page unavailable for the fact sheet', error);
    }
  }
  if (input.artwork.wikidataId) {
    try {
      const entity = await getEntity(input.artwork.wikidataId);
      const text = entity ? await wikidataSummary(entity) : '';
      if (entity && text) sources.push({ url: `https://www.wikidata.org/wiki/${entity.id}`, label: 'Wikidata', score: wikidataScore(), text });
    } catch (error) {
      failures++;
      console.warn('Wikidata unavailable for the fact sheet', error);
    }
  }
  const response = await searchWithCredit(ctx, {
    query: `"${input.artwork.title.replace(/"/g, '')}" ${input.artwork.artist} painting`,
    includeDomains: admissibleDomains(), maxResults: SEARCH_RESULTS,
  });
  if (!response) failures++;
  for (const result of response?.results ?? []) {
    const score = sourceScore(result.url);
    if (score === null || !result.content.trim()) continue;
    sources.push({ url: result.url, label: bareHost(result.url), score, text: `${result.title}\n${result.content}`.trim() });
  }
  return { sources: sources.sort((a, b) => b.score - a.score), failures };
}
