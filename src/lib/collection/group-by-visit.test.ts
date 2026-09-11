import type { Id } from '../../../convex/_generated/dataModel';

import { formatDay, groupByVisit } from './group-by-visit';
import type { SavedWork, Visit } from '@/db/schema';

const venueId = 'museum-1' as Id<'museums'>;

function visit(localId: string, venueName: string, startedAt: number): Visit {
  return { localId, venueId, venueName, startedAt, endedAt: null, remoteVisitId: null };
}

function work(localId: string, visitLocalId: string | null, savedAt: number): SavedWork {
  return {
    localId, visitLocalId, venueId: null, venueName: null, gallery: null, savedAt, title: localId, artist: 'Unknown',
    date: null, medium: null, institution: null, objectId: null, artworkId: null, scanId: null, photoPath: null,
    cropPath: `crops/${localId}.jpg`, syncedAt: null, deletedAt: null,
  };
}

const met = visit('met', 'Metropolitan Museum of Art', new Date(2026, 8, 8, 14).getTime());
const deYoung = visit('dy', 'de Young', new Date(2026, 8, 1, 11).getTime());
const empty = visit('empty', 'Legion of Honor', new Date(2026, 8, 5).getTime());

it('formats a day without locale-dependent month names', () => {
  expect(formatDay(new Date(2026, 8, 8, 23, 59).getTime())).toBe('8 Sep 2026');
  expect(formatDay(new Date(2025, 0, 31).getTime())).toBe('31 Jan 2025');
});

it('groups works under their visit, newest visit first, keeping each section in the given order', () => {
  const works = [work('c', 'met', 5), work('b', 'dy', 4), work('a', 'met', 3)];
  expect(groupByVisit(works, [deYoung, empty, met])).toEqual([
    { key: 'met', title: 'Metropolitan Museum of Art · 8 Sep 2026', data: [works[0], works[2]] },
    { key: 'dy', title: 'de Young · 1 Sep 2026', data: [works[1]] },
  ]);
});

it('puts works without a known visit under "Imported" after every visit', () => {
  const works = [work('orphan', 'unknown-visit', 6), work('a', 'met', 3), work('none', null, 1)];
  const sections = groupByVisit(works, [met]);
  expect(sections.map((section) => section.title)).toEqual(['Metropolitan Museum of Art · 8 Sep 2026', 'Imported']);
  expect(sections[1]).toEqual({ key: 'imported', title: 'Imported', data: [works[0], works[2]] });
  expect(groupByVisit([], [met])).toEqual([]);
});
