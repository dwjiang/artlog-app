import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse, tavilySeurat } from './labelFixtures';
import { parseSearchResponse, search } from './tavily';

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('TAVILY_API_KEY', 'tvly-test');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Tavily search', () => {
  it('posts the label-verification request shape and parses results, images and credits', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(tavilySeurat));
    const response = await search({
      query: '"A Sunday on La Grande Jatte" Georges Seurat', includeDomains: ['artic.edu'], includeImages: true, maxResults: 5,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.tavily.com/search');
    expect(init).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer tvly-test' } });
    expect(JSON.parse(String(init?.body))).toEqual({
      query: '"A Sunday on La Grande Jatte" Georges Seurat',
      search_depth: 'basic', auto_parameters: false, topic: 'general',
      include_domains: ['artic.edu'], include_domains_mode: 'filter',
      include_images: true, max_results: 5, include_usage: true,
    });
    expect(response.credits).toBe(1);
    expect(response.results).toHaveLength(5);
    expect(response.results[4]).toMatchObject({ url: 'https://www.artic.edu/artworks/27992/a-sunday-on-la-grande-jatte-1884', score: 0.81133276 });
    expect(response.results[4].images).toHaveLength(2);
    expect(response.images[0]).toBe('https://www.artic.edu/iiif/2/2d484387-2509-5e8e-2c43-22f9981972eb/full/843,/0/default.jpg');
  });

  it('adds news options only when requested and tolerates object-shaped images', () => {
    expect(parseSearchResponse({
      results: [{ url: 'https://a.example/x', title: 't', content: 'c', score: 0.5, published_date: '2026-09-01' }, { bogus: true }],
      images: [{ url: 'https://a.example/i.jpg', description: 'd' }, 'https://a.example/j.jpg', 7],
      usage: { credits: 2 }, answer: 'text',
    })).toEqual({
      answer: 'text', credits: 2, requestId: undefined,
      images: ['https://a.example/i.jpg', 'https://a.example/j.jpg'],
      results: [{ url: 'https://a.example/x', title: 't', content: 'c', score: 0.5, publishedDate: '2026-09-01', images: [] }],
    });
  });

  it('includes time_range and include_answer for the news shape', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
    await search({ query: 'q', includeDomains: ['kqed.org'], topic: 'news', timeRange: 'month', includeAnswer: 'basic' });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      topic: 'news', time_range: 'month', include_answer: 'basic', include_images: false,
    });
  });

  it('returns full research content from the same basic search, tolerating unavailable extraction', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [
      { url: 'https://museum.example/one', content: 'Snippet', raw_content: 'Full curatorial essay' },
      { url: 'https://museum.example/two', content: 'Usable snippet', raw_content: null },
    ], usage: { credits: 1 } }));
    const response = await search({ query: 'painting history', includeDomains: ['museum.example'], includeRawContent: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ search_depth: 'basic', include_raw_content: 'markdown' });
    expect(response.results[0].rawContent).toBe('Full curatorial essay');
    expect(response.results[1]).toMatchObject({ content: 'Usable snippet', rawContent: undefined });
    expect(response.credits).toBe(1);
  });

  it('maps failures to search_error and refuses to run without a key', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 432 }));
    await expect(search({ query: 'q', includeDomains: ['a.example'] })).rejects.toMatchObject({ data: { code: 'search_error', reason: 'http_432' } });
    fetchMock.mockResolvedValueOnce(new Response('not json'));
    await expect(search({ query: 'q', includeDomains: ['a.example'] })).rejects.toMatchObject({ data: { code: 'search_error', reason: 'bad_json' } });
    vi.stubEnv('TAVILY_API_KEY', '');
    await expect(search({ query: 'q', includeDomains: ['a.example'] })).rejects.toMatchObject({ data: { code: 'search_unconfigured' } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
