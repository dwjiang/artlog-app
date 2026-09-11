import { personMatches } from './textMatch';

export type PageFields = {
  title?: string;
  artist?: string;
  date?: string;
  accession?: string;
  medium?: string;
  creditLine?: string;
};

export type ExtractedPage = {
  fields: PageFields;
  imageUrls: string[];
  source: 'jsonld' | 'meta' | 'none';
};

export function hasArtworkMetadata(page: ExtractedPage): boolean {
  return !!page.fields.title && (page.source === 'jsonld' || !!(page.fields.artist && page.fields.accession));
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
};
const ARTWORK_TYPES = new Set(['visualartwork', 'painting']);
const TITLE_SEPARATOR = /\s+[|\-–—]\s+|\s*\|\s*/;
const ACCESSION_WITH_CUE = /\b(?:accession|object)\s*(?:number|no\.?|#)?\s*:?\s*(\d{2,4}\.\d{1,4}(?:\.\d{1,4})?[a-z]?)\b/i;
// Bare tokens must start with a year so dimensions like "130.2" are not read as an accession.
const ACCESSION_BARE = /\b((?:1[5-9]|20)\d{2}\.\d{1,4}(?:\.\d{1,4})?)\b/;

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

function metaTags(html: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const match of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = new Map<string, string>();
    for (const attr of match[1].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      attrs.set(attr[1].toLowerCase(), decodeEntities(attr[2] ?? attr[3] ?? attr[4] ?? '').trim());
    }
    const key = (attrs.get('property') ?? attrs.get('name') ?? attrs.get('itemprop'))?.toLowerCase();
    const content = attrs.get('content');
    if (key && content && !tags.has(key)) tags.set(key, content);
  }
  return tags;
}

function jsonLdNodes(html: string): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1].trim());
    } catch {
      continue;
    }
    const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];
    while (queue.length) {
      const node = queue.shift();
      if (!node || typeof node !== 'object') continue;
      const record = node as Record<string, unknown>;
      if (Array.isArray(record['@graph'])) queue.push(...record['@graph']);
      nodes.push(record);
    }
  }
  return nodes;
}

function isArtworkNode(node: Record<string, unknown>): boolean {
  const type = node['@type'];
  return (Array.isArray(type) ? type : [type]).some(
    (entry) => typeof entry === 'string' && ARTWORK_TYPES.has(entry.toLowerCase()),
  );
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return text(value[0]);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return text(record.name ?? record.value ?? record['@value']);
  }
  return undefined;
}

function urls(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(urls);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return urls(record.url ?? record.contentUrl);
  }
  return [];
}

export function visibleText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ');
}

const BOILERPLATE = /<(script|style|noscript|nav|header|footer|aside|form|svg)\b[\s\S]*?<\/\1>/gi;

// Readable page text for the fact-sheet model: the main content region without site chrome.
export function pageText(html: string, maxChars = 6000): string {
  const region = /<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(html)?.[2] ??
    /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;
  return visibleText(region.replace(BOILERPLATE, ' ')).trim().slice(0, maxChars);
}

function splitTitle(value: string): string[] {
  return value.split(TITLE_SEPARATOR).map((part) => part.trim()).filter(Boolean);
}

// "Title | Museum" and "Artist - Title - Museum" both end with the site name.
function artworkPageTitle(value: string, artist?: string): string {
  const parts = splitTitle(value);
  if (parts.length <= 1) return value.trim();
  const title = parts.slice(0, -1);
  return (artist && title.length > 1 ? title.filter((part) => !personMatches(part, artist)) : title).join(' - ');
}

function findAccession(body: string): string | undefined {
  return ACCESSION_WITH_CUE.exec(body)?.[1] ?? ACCESSION_BARE.exec(body)?.[1];
}

export function extractPage(html: string): ExtractedPage {
  const meta = metaTags(html);
  const pageTitle = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim();
  const imageUrls: string[] = [];
  const fields: PageFields = {};
  const node = jsonLdNodes(html).find(isArtworkNode);
  const artworkTitle = node ? text(node.name ?? node.headline) : undefined;
  if (node) {
    fields.title = artworkTitle;
    fields.artist = text(node.creator ?? node.author ?? node.artist);
    fields.date = text(node.dateCreated);
    fields.medium = text(node.artMedium ?? node.material ?? node.artform);
    fields.creditLine = text(node.creditText);
    const identifier = text(node.identifier);
    if (identifier && !/^https?:/i.test(identifier)) fields.accession = identifier;
    imageUrls.push(...urls(node.image));
  }
  const body = visibleText(html);
  fields.artist ??= meta.get('author');
  fields.title ??= artworkPageTitle(meta.get('og:title') ?? pageTitle, fields.artist) || undefined;
  fields.accession ??= findAccession(body);
  if (!imageUrls.length) {
    const value = meta.get('og:image:secure_url') ?? meta.get('og:image') ?? meta.get('twitter:image');
    if (value) imageUrls.push(value);
  }
  return {
    fields: Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as PageFields,
    imageUrls: [...new Set(imageUrls)],
    source: artworkTitle ? 'jsonld' : fields.title || fields.artist ? 'meta' : 'none',
  };
}
