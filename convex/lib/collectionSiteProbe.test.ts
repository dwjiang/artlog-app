import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { probeCollectionSite } from './collectionSiteProbe';

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it.each([
  ['emuseum', '<title>eMuseum</title>'],
  ['emuseum', '<a href="/objects/12">Painting</a>'],
  ['iiif', '<a href="/iiif/work/manifest.json">Manifest</a>'],
  ['collectionspace', '<title>CollectionSpace Browser</title>'],
  ['generic', Array.from({ length: 20 }, (_, i) => `<a href='/artwork/${i}'>Work</a>`).join('')],
])('recognizes %s on a collection page', async (platform, html) => {
  fetchMock.mockImplementation(async (url) => new Response(new URL(String(url)).pathname === '/collection' ? html : '', { status: 200 }));
  expect(await probeCollectionSite('https://museum.example/about')).toEqual({ collectionSiteUrl: 'https://museum.example/collection', platform });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('probes no more than the six designated paths and identifies its User-Agent', async () => {
  vi.stubEnv('CRAWLER_CONTACT', 'ops@example.org');
  fetchMock.mockImplementation(async () => new Response('About the museum'));
  expect(await probeCollectionSite('https://museum.example')).toBeNull();
  expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
    '/', '/collection', '/collections', '/art/collection', '/objects', '/sitemap.xml',
  ]);
  expect(fetchMock.mock.calls[0][1]).toMatchObject({
    redirect: 'manual', headers: { 'User-Agent': 'artlog-bot/0.1 (+https://github.com/dwjiang/artlog-app; mailto:ops@example.org)' },
  });
});

it('does not count duplicate or external links as a generic collection', async () => {
  fetchMock.mockImplementation(async () => new Response(
    '<a href="/artwork/1">Same work</a>'.repeat(20) +
    Array.from({ length: 20 }, (_, i) => `<a href="https://elsewhere.example/artwork/${i}">External</a>`).join(''),
  ));
  expect(await probeCollectionSite('https://museum.example')).toBeNull();
});

it('ignores external platform links', async () => {
  fetchMock.mockImplementation(async () => new Response('<a href="https://other.example/objects/1">External</a>'));
  expect(await probeCollectionSite('https://museum.example')).toBeNull();
});

it('recognizes collection links in a sitemap without using the sitemap as a crawl root', async () => {
  fetchMock.mockImplementation(async (url) => new Response(String(url).endsWith('/sitemap.xml')
    ? '<urlset><url><loc>https://museum.example/objects/123</loc></url></urlset>' : ''));
  expect(await probeCollectionSite('https://museum.example')).toEqual({ collectionSiteUrl: 'https://museum.example/objects/', platform: 'emuseum' });
});

it('allows same-host redirects within the total request budget', async () => {
  fetchMock.mockImplementation(async (url) => String(url).endsWith('/catalog')
    ? new Response('eMuseum') : new Response(null, { status: 302, headers: { location: '/catalog' } }));
  expect(await probeCollectionSite('https://museum.example')).toMatchObject({ collectionSiteUrl: 'https://museum.example/catalog' });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it.each(['http://127.0.0.1/private', 'https://other.example/objects/', 'http://museum.example/objects/'])('rejects redirect target %s', async (location) => {
  fetchMock.mockImplementation(async () => new Response(null, { status: 302, headers: { location } }));
  expect(await probeCollectionSite('https://museum.example')).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(6);
  expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith('https://museum.example/'))).toBe(true);
});

it('ends redirect loops and caps chains at six requests', async () => {
  let step = 0;
  fetchMock.mockImplementation(async () => new Response(null, { status: 302, headers: { location: `/hop-${++step}` } }));
  expect(await probeCollectionSite('https://museum.example')).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(6);
});

it.each(['file:///etc/passwd', 'http://localhost/', 'http://127.1/', 'http://169.254.169.254/', 'http://[::1]/', 'https://user:pass@museum.example/', 'https://museum.example:9000/'])('never fetches invalid website %s', async (website) => {
  expect(await probeCollectionSite(website)).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('times out each request after five seconds and handles network failures', async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  const pending = probeCollectionSite('https://museum.example');
  await vi.advanceTimersByTimeAsync(30000);
  expect(await pending).toBe('retry');
  expect(fetchMock).toHaveBeenCalledTimes(6);
});

it.each([408, 429, 500, 503])('keeps an inconclusive HTTP %s response retryable even when other paths are missing', async (status) => {
  fetchMock.mockImplementation(async (url) => new Response('', {
    status: new URL(String(url)).pathname === '/collection' ? status : 404,
  }));
  expect(await probeCollectionSite('https://museum.example')).toBe('retry');
  expect(fetchMock).toHaveBeenCalledTimes(6);
});

it.each([403, 404, 410])('treats definitive HTTP %s responses as an unavailable collection', async (status) => {
  fetchMock.mockImplementation(async () => new Response('', { status }));
  expect(await probeCollectionSite('https://museum.example')).toBeNull();
});

it('rejects oversized bodies and continues past HTTP failures', async () => {
  fetchMock.mockResolvedValueOnce(new Response('x'.repeat(1024 * 1024 + 1)))
    .mockResolvedValueOnce(new Response('eMuseum', { status: 503 }))
    .mockImplementation(async () => new Response('CollectionSpace'));
  expect(await probeCollectionSite('https://museum.example')).toEqual({ collectionSiteUrl: 'https://museum.example/collections', platform: 'collectionspace' });
});
