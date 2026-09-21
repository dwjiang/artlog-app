import { describe, expect, it } from 'vitest';

import { labelUser, parseLabelReading, titleWithoutDate } from './labelPrompt';

describe('title without its printed date', () => {
  it.each([
    ['Reclining Figure: Arch Leg, 1969', '1969', 'Reclining Figure: Arch Leg'],
    ['Cubi XV, 1963-64', '1963-64', 'Cubi XV'],
    ['Retrato de D. Alfonso XIII (1929)', '(1929)', 'Retrato de D. Alfonso XIII'],
    ['Hasta verte Cristo mío 1895', '1895', 'Hasta verte Cristo mío'],
    ['Flying female shaman, ca. 1850', 'ca. 1850', 'Flying female shaman'],
    ['Skeleton bear (in shamanic transformation), n.d.', 'n.d.', 'Skeleton bear (in shamanic transformation)'],
  ])('strips %s with work date %s', (title, workDate, expected) => {
    expect(titleWithoutDate(title, workDate)).toBe(expected);
  });

  it.each([
    ['Night Presence II', '1976'],
    ['Composition 1930', '1931'],
    ['Study (1912) for a mural', '1912'],
    ['1969', '1969'],
    ['Playground', 'n.d.'],
    ['Room 11969', '1969'],
    ['Water Lilies', null],
  ])('keeps %s when the date is absent, different, inside, unbounded, or the whole title', (title, workDate) => {
    expect(titleWithoutDate(title, workDate)).toBe(title);
  });
});

describe('label reading contract', () => {
  it('sends the lines and the schema as the user message', () => {
    const lines = [{ text: 'Claude Monet', confidence: 1 }, { text: 'Water Lilies, 1919', confidence: 0.5 }];
    expect(JSON.parse(labelUser(lines))).toEqual({ lines, schema: expect.objectContaining({ type: 'object' }) });
  });

  it('rejects readings with extra keys, wrong types, or confidences outside the unit interval', () => {
    const confidence = { title: 1, artist: 0.5, work_date: 0, medium: 1, accession: 1 };
    const reading = { title: 'A', artist: null, artist_dates: null, work_date: null, medium: null, accession: null, credit_line: null, confidence };
    expect(parseLabelReading(reading)).toEqual(reading);
    expect(parseLabelReading({ ...reading, extra: 1 })).toBeNull();
    expect(parseLabelReading({ ...reading, title: 1 })).toBeNull();
    expect(parseLabelReading({ ...reading, confidence: { ...confidence, title: 1.5 } })).toBeNull();
    expect(parseLabelReading({ ...reading, confidence: { title: 1 } })).toBeNull();
  });
});
