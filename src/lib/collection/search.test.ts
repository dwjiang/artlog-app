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
