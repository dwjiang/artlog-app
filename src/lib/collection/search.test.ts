import { filterWorks } from './search';

const works = [
  { localId: 'lilies', title: 'Water Lilies', artist: 'Claude Monet', institution: "Musée d'Orsay" },
  { localId: 'cotton', title: '100% Cotton', artist: 'Anon', institution: 'de Young' },
  { localId: 'bare', title: 'Untitled', artist: 'Monet', institution: null },
];

it.each([
  ['', ['lilies', 'cotton', 'bare']],
  ['   ', ['lilies', 'cotton', 'bare']],
  ['MONET', ['lilies', 'bare']],
  ['water', ['lilies']],
  ['orsay', ['lilies']],
  ['100%', ['cotton']],
  ['young', ['cotton']],
  ['nothing here', []],
])('filters by title, artist or institution for %p', (query, expected) => {
  expect(filterWorks(works, query).map((work) => work.localId)).toEqual(expected);
});

it('normalizes accents and whitespace and searches dates, venue names and cities', () => {
  const works = [{ title: 'Nymphéas', artist: 'Claude Monet', institution: null, date: '1916', venueName: 'Musée   d’Orsay', city: 'París' }];
  for (const query of ['nympheas', '  MUSEE  ', '1916', 'paris', 'Claude   Monet']) expect(filterWorks(works, query)).toEqual(works);
  expect(filterWorks(works, 'm')).toEqual([]);
  expect(filterWorks(works, 'x'.repeat(101))).toEqual([]);
});
