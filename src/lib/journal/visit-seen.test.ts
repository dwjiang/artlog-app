import { renderHook, waitFor } from '@testing-library/react-native';
import { db } from '@/db/client';
import { settings } from '@/db/schema';
import { isVisitNew, markVisitSeen, useSeenVisits } from './visit-seen';

jest.mock('@/db/client', () => ({ db: jest.requireActual('@/db/test-db').createTestDatabase() }));

beforeEach(() => { db.delete(settings).run(); });

it('shows a closed visit as new until it is opened, never an open or manual one', () => {
  const seen = new Set<string>();
  expect(isVisitNew({ localId: 'closed', endedAt: 5 }, seen)).toBe(true);
  expect(isVisitNew({ localId: 'open', endedAt: null }, seen)).toBe(false);
  markVisitSeen('closed', 'device:a');
  markVisitSeen('closed', 'device:a');
  expect(db.select().from(settings).all()).toEqual([{ key: 'seenVisits:device:a', value: '["closed"]' }]);
  expect(isVisitNew({ localId: 'closed', endedAt: 5 }, new Set(['closed']))).toBe(false);
});

it('keeps seen visits per owner and survives an unreadable value', async () => {
  db.insert(settings).values({ key: 'seenVisits:device:b', value: 'not json' }).run();
  markVisitSeen('x', 'device:b');
  markVisitSeen('y', 'device:c');
  const { result } = await renderHook(() => useSeenVisits('device:b'));
  await waitFor(() => expect(result.current.has('x')).toBe(true));
  expect(result.current.has('y')).toBe(false);
});
