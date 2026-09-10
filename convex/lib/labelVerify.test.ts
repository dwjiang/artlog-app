import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { graphPage, jsonLdPage, metaPage, plainPage, tavilyMonet, tavilyRodin, tavilySeurat, tavilyStarryNight } from './labelFixtures';
import { evidenceSummary, labelField, selectTavilyEvidence, trimInput, venueCountryMatch, verifyAccession } from './labelVerify';
import { parseSearchResponse } from './tavily';

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response('<html></html>'));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Tavily evidence selection (decision 007 cases)', () => {
  it.each(['search', 'metadata'])('rejects a poster of After the Bath identified by %s', async (source) => {
    const title = 'After the Bath';
    const artist = 'Edgar Degas';
    const node = { '@type': 'VisualArtwork', name: source === 'metadata' ? `${title} Poster` : title, creator: artist };
    fetchMock.mockResolvedValueOnce(new Response(`<script type="application/ld+json">${JSON.stringify(node)}</script>`));
    const response = parseSearchResponse({ results: [{
      url: 'https://shop.museum.example/products/after-the-bath',
      title: source === 'search' ? `${title} Poster` : title, content: `${title} by ${artist}`, score: 0.9,
    }] });
    expect(await selectTavilyEvidence(response, { title, artist }, ['museum.example'])).toBeNull();
  });

  it.each([
    '<meta property="og:title" content="Haystacks | Museum"><meta name="author" content="Claude Monet">',
    '<meta property="og:title" content="Water Lilies | Museum"><meta name="author" content="Camille Pissarro">',
    '<p>Accession Number: 1983.532</p>',
    plainPage,
  ])('rejects contradictions in partial page metadata', async (html) => {
    fetchMock.mockResolvedValueOnce(new Response(html));
    const response = parseSearchResponse({ results: [tavilyMonet.results[0]] });
    expect(await selectTavilyEvidence(response, {
      title: 'Water Lilies', artist: 'Claude Monet', accession: '1998.325.2',
    }, ['metmuseum.org'])).toBeNull();
  });

  it('keeps matching partial metadata as text evidence without approving its image', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<meta property="og:title" content="Water Lilies | Museum">' +
      '<meta name="author" content="Claude Monet"><meta property="og:image" content="/sharing.jpg">'));
    const response = parseSearchResponse({ results: [tavilyMonet.results[0]] });
    expect(await selectTavilyEvidence(response, { title: 'Water Lilies', artist: 'Claude Monet' }, ['metmuseum.org']))
      .toEqual({ sourceUrl: tavilyMonet.results[0].url, imageUrls: [] });
  });

  it('picks the canonical object page ranked fifth over the study, sketch, poster and artist pages', async () => {
    const evidence = await selectTavilyEvidence(parseSearchResponse(tavilySeurat), { title: 'A Sunday on La Grande Jatte', artist: 'Georges Seurat' }, ['artic.edu']);
    expect(evidence).toEqual({
      sourceUrl: 'https://www.artic.edu/artworks/27992/a-sunday-on-la-grande-jatte-1884',
      imageUrls: [],
    });
  });

  it('gets images from the selected artwork metadata instead of related-work search images', async () => {
    fetchMock.mockResolvedValueOnce(new Response(jsonLdPage));
    const evidence = await selectTavilyEvidence(parseSearchResponse(tavilyMonet), { title: 'Water Lilies', artist: 'Claude Monet' }, ['metmuseum.org']);
    expect(evidence?.sourceUrl).toBe('https://www.metmuseum.org/art/collection/search/437137');
    expect(evidence?.imageUrls).toEqual([
      'https://collectionapi.metmuseum.org/api/collection/v1/iiif/437137/2018391/main-image',
    ]);
    expect(evidence?.imageUrls.some((url) => url.includes('sanity.io'))).toBe(false);
  });

  it.each(['search', 'metadata'])('does not use a sketch image for the finished painting when only %s identifies the sketch', async (source) => {
    const sketch = tavilySeurat.results[1];
    const title = 'Oil Sketch for A Sunday on La Grande Jatte — 1884';
    const painting = 'A Sunday on La Grande Jatte — 1884';
    const node = {
      '@type': 'VisualArtwork', name: source === 'metadata' ? title : painting,
      creator: 'Georges Seurat', image: sketch.images[0],
    };
    fetchMock.mockResolvedValueOnce(new Response(`<script type="application/ld+json">${JSON.stringify(node)}</script>`));
    const response = parseSearchResponse({ results: [{ ...sketch, title: source === 'search' ? title : painting }] });
    const evidence = await selectTavilyEvidence(response, { title: painting, artist: 'Georges Seurat' }, ['artic.edu']);
    expect(evidence).toBeNull();
  });

  it('returns a sketch image when the label identifies that sketch', async () => {
    const sketch = tavilySeurat.results[1];
    const title = 'Oil Sketch for A Sunday on La Grande Jatte — 1884';
    const node = { '@type': 'VisualArtwork', name: title, creator: 'Georges Seurat', image: sketch.images[0] };
    fetchMock.mockResolvedValueOnce(new Response(`<script type="application/ld+json">${JSON.stringify(node)}</script>`));
    const evidence = await selectTavilyEvidence(parseSearchResponse({ results: [sketch] }), { title, artist: 'Georges Seurat' }, ['artic.edu']);
    expect(evidence).toEqual({ sourceUrl: sketch.url, imageUrls: [sketch.images[0]] });
  });

  it('cannot tell two casts apart by title and artist but resolves them with the accession', async () => {
    const response = parseSearchResponse(tavilyRodin);
    expect((await selectTavilyEvidence(response, { title: 'The Thinker', artist: 'Auguste Rodin' }, ['clevelandart.org']))?.sourceUrl)
      .toBe('https://www.clevelandart.org/art/1979.138');
    fetchMock.mockResolvedValueOnce(new Response(graphPage));
    const cast = await selectTavilyEvidence(response, { title: 'The Thinker', artist: 'Auguste Rodin', accession: '1917.42' }, ['clevelandart.org']);
    expect(cast?.sourceUrl).toBe('https://www.clevelandart.org/art/1917.42');
    expect(cast?.imageUrls).toEqual(['https://openaccess-cdn.clevelandart.org/1917.42/1917.42_web.jpg']);
  });

  it('chooses the collection page over the audio guide and shop, and never returns global images', async () => {
    const response = parseSearchResponse(tavilyStarryNight);
    const evidence = await selectTavilyEvidence(response, { title: 'The Starry Night', artist: 'Vincent van Gogh' }, ['moma.org']);
    expect(evidence).toEqual({ sourceUrl: 'https://www.moma.org/collection/works/79802', imageUrls: [] });
  });

  it('keeps text evidence without using images from a non-artwork page', async () => {
    const response = parseSearchResponse({ ...tavilyStarryNight, results: [tavilyStarryNight.results[0], tavilyStarryNight.results[2]] });
    const evidence = await selectTavilyEvidence(response, { title: 'The Starry Night', artist: 'Vincent van Gogh' }, ['moma.org']);
    expect(evidence?.sourceUrl).toBe('https://www.moma.org/audio/playlist/3/4289');
    expect(evidence?.imageUrls).toEqual([]);
  });

  it('returns nothing when no result names both the title and the artist or the host is wrong', async () => {
    const response = parseSearchResponse(tavilyMonet);
    expect(await selectTavilyEvidence(response, { title: 'Water Lilies', artist: 'Camille Pissarro' }, ['metmuseum.org'])).toBeNull();
    expect(await selectTavilyEvidence(response, { title: 'Haystacks', artist: 'Claude Monet' }, ['metmuseum.org'])).toBeNull();
    expect(await selectTavilyEvidence(response, { title: 'Water Lilies', artist: 'Claude Monet' }, ['moma.org'])).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses og:image when artwork metadata establishes the title, artist and accession', async () => {
    fetchMock.mockResolvedValueOnce(new Response(metaPage));
    const response = parseSearchResponse({ results: [{ url: 'https://www.artic.edu/artworks/111628', title: 'Nighthawks', content: 'Edward Hopper' }] });
    const evidence = await selectTavilyEvidence(response, { title: 'Nighthawks', artist: 'Edward Hopper' }, ['artic.edu']);
    expect(evidence?.imageUrls).toEqual(['https://www.artic.edu/iiif/2/831a05de-d3f6-f4fa-a460-23008dd58dda/full/843,/0/default.jpg']);
  });

  it.each([
    jsonLdPage.replaceAll('Water Lilies', 'Haystacks'),
    jsonLdPage.replace('"name":"Water Lilies"', '"name":"Haystacks"'),
    jsonLdPage.replaceAll('Claude Monet', 'Camille Pissarro'),
    jsonLdPage.replaceAll('1998.325.2', '1983.532'),
  ])('rejects evidence when fetched artwork metadata conflicts with the identity', async (html) => {
    fetchMock.mockResolvedValueOnce(new Response(html));
    const evidence = await selectTavilyEvidence(parseSearchResponse({ results: [tavilyMonet.results[0]] }), {
      title: 'Water Lilies', artist: 'Claude Monet', accession: '1998.325.2',
    }, ['metmuseum.org']);
    expect(evidence).toBeNull();
  });

  it.each(['Related artworks:', '## More Artwork', 'Related works:'])('does not associate an artist from a %s section with the main work', async (heading) => {
    const response = parseSearchResponse({ results: [{
      url: tavilyMonet.results[0].url, title: 'Water Lilies - Camille Pissarro',
      content: `Water Lilies by Camille Pissarro.\n${heading}\nHaystacks by Claude Monet.`,
    }] });
    expect(await selectTavilyEvidence(response, { title: 'Water Lilies', artist: 'Claude Monet' }, ['metmuseum.org'])).toBeNull();
  });

  it('tries the next result when the first artwork explicitly contradicts the artist', async () => {
    fetchMock.mockResolvedValueOnce(new Response(jsonLdPage.replaceAll('Claude Monet', 'Camille Pissarro')));
    fetchMock.mockResolvedValueOnce(new Response(jsonLdPage));
    const response = parseSearchResponse({ results: [tavilyMonet.results[0], tavilyMonet.results[3]] });
    const result = await selectTavilyEvidence(response, { title: 'Water Lilies', artist: 'Claude Monet' }, ['metmuseum.org']);
    expect(result?.sourceUrl).toBe(tavilyMonet.results[3].url);
    expect(result?.imageUrls).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('filters unsafe images, resolves relative URLs, deduplicates and caps artwork images', async () => {
    const node = { '@type': 'VisualArtwork', name: 'Water Lilies', creator: 'Claude Monet', image: [
      'https://evil.example/image.jpg', 'http://images.metmuseum.org/work.jpg', '/pixel.gif', '/logo.svg',
      '/work.jpg', 'https://www.metmuseum.org/work.jpg', '/detail.jpg', '/back.jpg', '/frame.jpg',
    ] };
    fetchMock.mockResolvedValueOnce(new Response(`<script type="application/ld+json">${JSON.stringify(node)}</script>`));
    const evidence = await selectTavilyEvidence(parseSearchResponse(tavilyMonet), { title: 'Water Lilies', artist: 'Claude Monet' }, ['metmuseum.org']);
    expect(evidence?.imageUrls).toEqual(['https://www.metmuseum.org/work.jpg', 'https://www.metmuseum.org/detail.jpg', 'https://www.metmuseum.org/back.jpg']);
  });

  it.each([503, 302])('keeps text evidence when the artwork page fails with HTTP %i', async (status) => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status, headers: { location: 'https://evil.example/' } }));
    const evidence = await selectTavilyEvidence(parseSearchResponse(tavilyMonet), { title: 'Water Lilies', artist: 'Claude Monet' }, ['metmuseum.org']);
    expect(evidence).toMatchObject({ sourceUrl: tavilyMonet.results[0].url, imageUrls: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('summarizes locking evidence and trims input', () => {
    expect(evidenceSummary({
      title: labelField('a', 'tavily+image'), artist: labelField('b', 'wikidata'), date: labelField('c', 'weak'), medium: labelField('d', 'ocr'),
    })).toEqual(['tavily+image', 'wikidata']);
    expect(labelField('x', 'accession', 0.5)).toEqual({ value: 'x', evidence: 'accession', locked: true, confidence: 0.5 });
    expect(labelField('x', 'ocr')).toEqual({ value: 'x', evidence: 'ocr', locked: false });
    expect(trimInput({ title: '  Water Lilies ', artist: '  ', date: undefined })).toEqual({ title: 'Water Lilies' });
  });
});

describe('accession title verification', () => {
  const venue = { accessionUrlPattern: 'https://www.metmuseum.org/art/{accession}' };
  it('does not identify an artwork from an artist with a conflicting given name', async () => {
    const html = jsonLdPage.replaceAll('Claude Monet', 'Pieter Brueghel the Younger');
    fetchMock.mockResolvedValueOnce(new Response(html));
    expect(await verifyAccession(venue, ['metmuseum.org'], {
      artist: 'Jan Brueghel the Younger', accession: '1998.325.2',
    })).toBeNull();
  });

  it.each(['Claude Monet', 'The Metropolitan Museum of Art'])('does not verify the title "%s" from page decoration', async (title) => {
    fetchMock.mockResolvedValueOnce(new Response(jsonLdPage));
    expect(await verifyAccession(venue, ['metmuseum.org'], { title, artist: 'Claude Monet', accession: '1998.325.2' })).toBeNull();
  });

  it('uses the structured title even when the page title names a different artwork', async () => {
    fetchMock.mockResolvedValueOnce(new Response(jsonLdPage.replace('"name":"Water Lilies"', '"name":"Haystacks"')));
    expect(await verifyAccession(venue, ['metmuseum.org'], { title: 'Water Lilies', accession: '1998.325.2' })).toBeNull();
  });

  it('accepts the artwork title from decorated meta tags without accepting the author', async () => {
    const html = metaPage.replace('Nighthawks | The Art Institute', 'Edward Hopper - Nighthawks | The Art Institute');
    fetchMock.mockImplementation(async () => new Response(html));
    const venue = { accessionUrlPattern: 'https://www.artic.edu/art/{accession}' };
    expect(await verifyAccession(venue, ['artic.edu'], { title: 'Nighthawks', accession: '1942.51' })).not.toBeNull();
    expect(await verifyAccession(venue, ['artic.edu'], { title: 'Edward Hopper', accession: '1942.51' })).toBeNull();
  });
});

it('finds the venue country in collections beyond the first Wikidata batch', async () => {
  const claim = (id: string) => ({ mainsnak: { datavalue: { value: { id } } } });
  const ids = Array.from({ length: 50 }, (_, i) => `Q${1000 + i}`);
  fetchMock.mockImplementation(async (value) => {
    const requested = new URL(String(value)).searchParams.get('ids')!.split('|');
    return new Response(JSON.stringify({ entities: Object.fromEntries(requested.map((id) => [id, {
      id, claims: { P17: [claim(id === 'Q5000' || id === ids.at(-1) ? 'Q30' : 'Q142')] },
    }])) }));
  });
  expect(await venueCountryMatch({ id: 'Q1', claims: { P6379: ids.map(claim) } }, { wikidataId: 'Q5000' })).toBe(true);
});
