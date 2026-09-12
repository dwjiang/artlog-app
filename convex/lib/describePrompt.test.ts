import { describe, expect, it } from 'vitest';

import { DESCRIBE_SCHEMA, DESCRIBE_SYSTEM_PROMPT, parseDescription, searchQuery } from './describePrompt';

const valid = {
  description: 'A woman in a wide brimmed hat, loose brushwork, vivid green, violet and orange patches',
  artist_guess: 'Henri Matisse',
  confidence: 0.8,
};

describe('describe prompt', () => {
  it('parses the schema shape and normalizes whitespace', () => {
    expect(parseDescription(valid)).toEqual({ description: valid.description, artistGuess: 'Henri Matisse', confidence: 0.8 });
    expect(parseDescription({ ...valid, artist_guess: null, confidence: 0 })).toEqual({
      description: valid.description, artistGuess: null, confidence: 0,
    });
    expect(parseDescription({ ...valid, description: '  two\n\n lines ', artist_guess: '   ' })).toEqual({
      description: 'two lines', artistGuess: null, confidence: 0.8,
    });
  });

  it.each([
    ['extra keys', { ...valid, title: 'Woman with a Hat' }],
    ['a missing description', { artist_guess: null, confidence: 0 }],
    ['an empty description', { ...valid, description: ' \n ' }],
    ['an oversize description', { ...valid, description: 'x'.repeat(401) }],
    ['a non-string guess', { ...valid, artist_guess: 3 }],
    ['a missing guess', { description: valid.description, confidence: 0.5 }],
    ['confidence outside 0–1', { ...valid, confidence: 1.5 }],
    ['a non-numeric confidence', { ...valid, confidence: '0.5' }],
    ['a non-object', 'text'],
    ['an array', [valid]],
  ])('rejects %s', (_, value) => {
    expect(parseDescription(value)).toBeNull();
  });

  it('includes the artist guess only at or above the confidence bar', () => {
    expect(searchQuery({ description: 'lily pads on water', artistGuess: 'Claude Monet', confidence: 0.5 })).toBe('lily pads on water Claude Monet');
    expect(searchQuery({ description: 'lily pads on water', artistGuess: 'Claude Monet', confidence: 0.49 })).toBe('lily pads on water');
    expect(searchQuery({ description: 'lily pads on water', artistGuess: null, confidence: 1 })).toBe('lily pads on water');
  });

  it('keeps the query within 300 characters without dropping the guess', () => {
    const query = searchQuery({ description: 'word '.repeat(80), artistGuess: 'Claude Monet', confidence: 0.9 });
    expect(query.length).toBeLessThanOrEqual(300);
    expect(query.endsWith(' Claude Monet')).toBe(true);
    expect(query).not.toMatch(/\s{2,}/);
  });

  it('tells the model never to name the work and forbids extra keys', () => {
    expect(DESCRIBE_SYSTEM_PROMPT).toContain('never name the work');
    expect(DESCRIBE_SCHEMA.additionalProperties).toBe(false);
    expect(DESCRIBE_SCHEMA.required).toEqual(['description', 'artist_guess', 'confidence']);
  });
});
