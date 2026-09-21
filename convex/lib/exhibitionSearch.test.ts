import { describe, expect, it } from 'vitest';

import { exhibitionCandidates } from './exhibitionSearch';
import { parseSearchResponse } from './tavily';

describe('exhibition image candidates', () => {
  it('keeps images bound to their museum page without treating its title as an artwork', () => {
    const response = parseSearchResponse({
      images: ['https://museum.example/unrelated.jpg'],
      results: [{ url: 'https://museum.example/exhibitions/colour', title: 'A Century of Colour', content: 'Several artists.', score: 0.9,
        images: [{ url: 'https://museum.example/red.jpg' }, 'https://museum.example/blue.jpg'] }],
    });
    expect(exhibitionCandidates(response, ['museum.example'])).toEqual([{
      sourceUrl: 'https://museum.example/exhibitions/colour',
      exhibition: { title: 'A Century of Colour', content: 'Several artists.' },
      imageUrls: ['https://museum.example/red.jpg', 'https://museum.example/blue.jpg'],
    }]);
  });

  it('rejects off-site pages, unsafe images, shops, and global images without a source association', () => {
    const response = parseSearchResponse({ images: ['https://museum.example/global.jpg'], results: [
      { url: 'https://evil.example/exhibitions/x', images: ['https://museum.example/one.jpg'] },
      { url: 'https://museum.example/shop/x', images: ['https://museum.example/two.jpg'] },
      { url: 'https://museum.example/exhibitions/x', images: ['http://museum.example/i.jpg', 'https://127.0.0.1/i.jpg', 'https://user:password@museum.example/i.jpg', 'https://museum.example/logo.svg'] },
    ] });
    expect(exhibitionCandidates(response, ['museum.example'])).toEqual([]);
  });

  it('accepts public CDN images associated with an allowed museum page', () => {
    const response = parseSearchResponse({ results: [{ url: 'https://museum.example/exhibitions/x',
      images: ['https://images.cdn.example/blue.jpg'] }] });
    expect(exhibitionCandidates(response, ['museum.example'])[0].imageUrls).toEqual(['https://images.cdn.example/blue.jpg']);
  });

  it('deduplicates pages and images and bounds the work sent to the phone', () => {
    const result = (id: number) => ({ url: `https://museum.example/exhibitions/${id}`, score: 1,
      images: Array.from({ length: 20 }, (_, i) => `https://museum.example/${i}.jpg`) });
    const candidates = exhibitionCandidates(parseSearchResponse({ results: [result(1), result(1), result(2), result(3), result(4)] }), ['museum.example']);
    expect(candidates).toHaveLength(3);
    expect(candidates.every((candidate) => candidate.imageUrls.length === 6)).toBe(true);
  });
});
