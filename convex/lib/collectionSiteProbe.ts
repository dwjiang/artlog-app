export type CollectionSite = {
  collectionSiteUrl: string;
  platform: 'emuseum' | 'iiif' | 'collectionspace' | 'generic';
};

const PATHS = ['/', '/collection', '/collections', '/art/collection', '/objects', '/sitemap.xml'];
const MAX_BODY_BYTES = 1024 * 1024;

export function websiteUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      (url.port && !['80', '443'].includes(url.port)) || !host.includes('.') ||
      /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) ||
      host.includes(':') || /^[\d.]+$/.test(host) || value.length > 2048) return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function sameHostUrl(value: string, base: URL): URL | null {
  const url = websiteUrl(new URL(value, base).href);
  return url && url.hostname === base.hostname &&
    !(base.protocol === 'https:' && url.protocol === 'http:') ? url : null;
}

function detectCollection(body: string, page: URL): CollectionSite | null {
  const links: URL[] = [];
  const rawLinks = body.matchAll(/\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))|<loc\b[^>]*>\s*([^<]+)\s*<\/loc>/gi);
  for (const match of rawLinks) {
    try {
      const link = sameHostUrl((match[1] ?? match[2] ?? match[3] ?? match[4]).replace(/&amp;/g, '&').trim(), page);
      if (link) links.push(link);
    } catch { /* Malformed markup is not a crawl target. */ }
  }
  const collectionPath = /\/(?:objects?|artworks?|collections?)(?:\/|$)/i;
  const target = links.find((link) => collectionPath.test(link.pathname));
  const collectionSiteUrl = /sitemap\.xml$/i.test(page.pathname)
    ? target ? new URL(target.pathname.replace(/\/[^/]+\/?$/, '/'), target).href : page.origin
    : page.href;
  if (/\bcollectionspace\b/i.test(body)) return { collectionSiteUrl, platform: 'collectionspace' };
  if (links.some((link) => /\/iiif\//i.test(link.pathname))) return { collectionSiteUrl, platform: 'iiif' };
  if (/\bemuseum\b/i.test(body) || links.some((link) => /\/objects\//i.test(link.pathname))) {
    return { collectionSiteUrl, platform: 'emuseum' };
  }
  if (new Set(links.filter((link) => collectionPath.test(link.pathname)).map((link) => link.pathname)).size >= 20) {
    return { collectionSiteUrl, platform: 'generic' };
  }
  return null;
}

async function readBody(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return body + decoder.decode();
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) throw new Error('Probe response too large');
      body += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
}

export async function probeCollectionSite(website: string): Promise<CollectionSite | null | 'retry'> {
  const root = websiteUrl(website);
  if (!root) return null;
  const pending = PATHS.map((path) => new URL(path, root));
  const visited = new Set<string>();
  let retryable = false;
  const contact = process.env.CRAWLER_CONTACT;
  const userAgent = `artlog-bot/0.1 (+https://github.com/dwjiang/artlog-app${contact ? `; mailto:${contact}` : ''})`;
  while (pending.length && visited.size < 6) {
    const url = pending.shift()!;
    if (visited.has(url.href)) continue;
    visited.add(url.href);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url.href, {
        redirect: 'manual', signal: controller.signal,
        headers: { 'User-Agent': userAgent, Accept: 'text/html, application/xml;q=0.9' },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        const next = location && sameHostUrl(location, url);
        if (next) pending.unshift(next);
        await response.body?.cancel();
        continue;
      }
      if (!response.ok) {
        if (response.status === 408 || response.status === 429 || response.status >= 500) retryable = true;
        await response.body?.cancel();
        continue;
      }
      const result = detectCollection(await readBody(response), url);
      if (result) return result;
    } catch {
      retryable = true;
    } finally {
      clearTimeout(timeout);
    }
  }
  return retryable ? 'retry' : null;
}
