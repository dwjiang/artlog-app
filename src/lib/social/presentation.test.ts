import { artworkCount, friendshipActions, initials, peopleSearch, visitDate } from './presentation';
import type { Relationship } from './types';

it('formats calendar dates without shifting the visit into another day', () => {
  expect(visitDate('2026-01-01', 'en-US')).toBe('January 1, 2026');
  expect(visitDate('2026-01-01', 'en-US', 'short')).toBe('Jan 1');
  expect(visitDate('2026-02-30', 'en-US')).toBe('Date unavailable');
  expect(visitDate('invalid')).toBe('Date unavailable');
});
it('uses first and last initials without inventing a photo', () => {
  expect(initials('  Alex River Chen ')).toBe('AC');
  expect(initials('李')).toBe('李');
  expect(initials('')).toBe('?');
});
it('reports incomplete artwork counts as lower bounds', () => {
  const page = Array.from({ length: 3 }, () => ({ itemId: 'item' as never, artwork: {} as never }));
  expect(artworkCount({ page, cursor: 'more', isDone: false })).toBe('3+ artworks shared');
  expect(artworkCount({ page: page.slice(0, 1), cursor: null, isDone: true })).toBe('1 artwork shared');
  expect(artworkCount({ page: [], cursor: null, isDone: true })).toBe('0 artworks shared');
});
it('enforces existing search limits before sending a request', () => {
  expect(peopleSearch('a')).toBeUndefined();
  expect(peopleSearch('a'.repeat(201))).toBeUndefined();
  expect(peopleSearch(Array(17).fill('word').join(' '))).toBeUndefined();
  expect(peopleSearch(' Alex  Chen ')).toBe('alex chen');
});
it.each([
  ['none', null, false, ['request']],
  ['pending', 'me', false, ['cancel']],
  ['pending', 'other', false, ['accept', 'decline']],
  ['accepted', 'other', false, ['remove']],
  ['none', null, true, []],
] as const)('offers the allowed actions for %s / %s / blocked %s', (state, requesterId, blocked, actions) => {
  expect(friendshipActions({ state, requesterId, blocked, revision: 2, blockRevision: 0 } as Relationship, 'me')).toEqual(actions);
});
