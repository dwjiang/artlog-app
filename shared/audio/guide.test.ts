import { guideOpening, guideResearch, parseGuideLines, unsupportedLines, validateGuide, validateGuideBody } from './guide';
import { guideBodyFixture, guideFixture, openingFixture, researchFixture } from './guide-fixtures';

const ids = new Set(researchFixture.map((fact) => fact.id));
const richIds = new Set([...ids, 'f3', 'f4', 'f5', 'f6', 'f7', 'f8']);
it('preserves a substantial spoken guide and all its supporting citations', () => {
  expect(validateGuide(guideFixture, ids, openingFixture)).toEqual(guideFixture);
  expect(validateGuideBody(guideBodyFixture, ids)).toEqual(guideBodyFixture);
});
it('opens with title, artist and the recorded date without inventing missing years', () => {
  expect(guideOpening({ title: 'Water Lilies', artist: 'Claude Monet', date: '1916' })).toBe(openingFixture);
  expect(guideOpening({ title: ' Study\n of a Young Woman ', artist: 'Johannes Vermeer', date: ' ca. 1665–67 ' }))
    .toBe('This is Study of a Young Woman, by Johannes Vermeer, dated ca. 1665–67.');
  for (const date of [undefined, '', '  ']) {
    expect(guideOpening({ title: 'Water Lilies', artist: 'Claude Monet', date }))
      .toBe('This is Water Lilies, by Claude Monet. Its date is unknown.');
  }
});
it('requires the exact metadata opening first and allows only that line to be uncited', () => {
  for (const value of [guideBodyFixture, [...guideBodyFixture, guideFixture[0]],
    [{ sentence: 'This is another painting.', factIds: [] }, ...guideBodyFixture],
    [{ ...guideFixture[0], factIds: ['f1'] }, ...guideBodyFixture]]) {
    expect(validateGuide(value, ids, openingFixture)).toBeNull();
  }
});
it('rejects tiny, uncited, invented, repeated and oversized guides', () => {
  for (const value of [null, [], guideFixture.slice(0, 1),
    guideFixture.map((line) => ({ ...line, factIds: [] })),
    guideFixture.map((line) => ({ ...line, factIds: ['invented'] })),
    [...guideFixture, guideFixture[0]],
    [...guideFixture, { sentence: 'word '.repeat(30), factIds: ['f1'] }]]) {
    expect(validateGuide(value, ids, openingFixture)).toBeNull();
  }
});
it('rejects a script whose sentence carries leaked JSON or markup, or was cut off', () => {
  for (const leak of ["She is a real person.', 'fact_ids': ['f4']}, {'sentence':", 'Look at the <emphasis>lilies</emphasis> on the pond.', 'The garden [f1] appears twice.', 'Cassatt said she wanted to draw out the', 'Notice the lilies on the pond, and the reflections around them']) {
    expect(validateGuideBody([...guideBodyFixture.slice(0, 9), { sentence: leak, factIds: ['f1'] }], ids)).toBeNull();
  }
});
it('accepts a sentence only when its support span is copied verbatim from a cited fact', () => {
  const lines = parseGuideLines([
    { sentence: 'Start with the lilies resting on the surface of the pond.', fact_ids: ['f1'], support: 'water lilies and reflections of the garden' },
    { sentence: 'Look closely at the visible strokes of oil paint.', fact_ids: ['f2'], support: '“using visible strokes  of oil paint”' },
    { sentence: 'The lilies float serenely in the evening light.', fact_ids: ['f1'], support: 'lilies float serenely' },
    { sentence: 'The artist returned to this garden repeatedly.', fact_ids: ['f1'], support: 'painted the garden repeatedly' },
    { sentence: 'Notice the pond.', fact_ids: ['f1'], support: 'pond' },
  ])!;
  expect(lines).toHaveLength(5);
  expect(unsupportedLines(lines, researchFixture).map((line) => line.sentence)).toEqual([
    'The lilies float serenely in the evening light.', 'The artist returned to this garden repeatedly.', 'Notice the pond.',
  ]);
  expect(parseGuideLines([{ sentence: 'No span here.', fact_ids: ['f1'] }])).toBeNull();
});
it('gives the guide only prose research, never catalogue lines', () => {
  const catalogue = ['Material: oil paint, canvas', 'Location: Metropolitan Museum of Art', 'Inception: 1665', 'Credit Line: Gift of a donor, 1990',
    'Provenance: The artist; sold to the museum, 1930.', 'Inventory number: 1993.132', ' Movement : Impressionism'];
  const prose = ['JUDITH BARTER: Well, he was riding around in the country one day.', 'Material studies show the artist mixed sand into the paint.'];
  const facts = [...catalogue, ...prose].map((text, index) => ({ ...researchFixture[0], id: `f${index + 1}`, text }));
  expect(guideResearch(facts).map((fact) => fact.text)).toEqual(prose);
});
it('accepts a guide only inside the 150 to 200 word band, or from 110 words when research is thin', () => {
  expect(validateGuideBody(guideBodyFixture.slice(0, 9), richIds)).toHaveLength(9);
  expect(validateGuideBody(guideBodyFixture.slice(0, 8), richIds)).toBeNull();
  expect(validateGuideBody(guideBodyFixture.slice(0, 7), ids)).toHaveLength(7);
  expect(validateGuideBody(guideBodyFixture.slice(0, 6), ids)).toBeNull();
});
