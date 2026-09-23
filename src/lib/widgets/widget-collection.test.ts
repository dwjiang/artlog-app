import type { ArtworkEncounter, ArtworkPhoto, SavedWork, Visit } from '@/db/schema';
import { widgetArtworkUrl, widgetCollection, widgetVisitDate } from './widget-collection';
import { defaultWidgetSettings, readWidgetSettings, widgetSettingsKey } from './widget-settings';

const works = [
  { owner: 'a', localId: 'painting', title: 'Water Lilies', artist: 'Claude Monet', cropPath: 'crop.jpg', photoPath: 'full.jpg', deletedAt: null },
  { owner: 'b', localId: 'private', title: 'Another account', deletedAt: null },
  { owner: 'a', localId: 'deleted', deletedAt: 1 },
] as SavedWork[];
const visits = [{ owner: 'a', localId: 'old', venueName: 'Old museum', visitedOn: '2024-01-02' },
  { owner: 'a', localId: 'new', venueName: 'New museum', visitedOn: '2026-09-08' }] as Visit[];
const encounters = [{ owner: 'a', savedLocalId: 'painting', visitLocalId: 'old', deletedAt: null },
  { owner: 'a', savedLocalId: 'painting', visitLocalId: 'new', deletedAt: null }] as ArtworkEncounter[];
const photos = [{ owner: 'a', savedLocalId: 'painting', kind: 'label', path: 'label.jpg', deletedAt: null },
  { owner: 'b', savedLocalId: 'painting', kind: 'full', path: 'private.jpg', deletedAt: null }] as ArtworkPhoto[];

it('uses the selected encounter for both the memory and the artwork link', () => {
  const all = widgetCollection('a', works, visits, encounters, photos, { kind: 'collection' });
  expect(all).toHaveLength(1);
  expect(all[0]).toMatchObject({ museum: 'New museum', visitedOn: '2026-09-08', paths: ['crop.jpg', 'full.jpg'] });
  const [old] = widgetCollection('a', works, visits, encounters, photos, { kind: 'visit', id: 'old' });
  expect(old.museum).toBe('Old museum');
  expect(widgetArtworkUrl(old)).toBe('artlog://saved/painting?visitId=old');
});

it('does not replace an unavailable selected visit or painting with unrelated art', () => {
  expect(widgetCollection('a', works, visits, encounters, photos, { kind: 'artwork', id: 'deleted' })).toEqual([]);
  expect(widgetCollection('a', works, visits, encounters, photos, { kind: 'artwork', id: 'private' })).toEqual([]);
  expect(widgetCollection('a', works, visits, encounters.map((row) => ({ ...row, deletedAt: 1 })), photos, { kind: 'visit', id: 'old' })).toEqual([]);
});

it('keeps visit calendar dates independent of the device time zone', () => {
  expect(widgetVisitDate('2026-09-08')).toBe('Sep 8, 2026');
  expect(widgetVisitDate()).toBe('');
  expect(widgetArtworkUrl({ id: 'art/1', visitId: 'visit 1' })).toBe('artlog://saved/art%2F1?visitId=visit%201');
});

it('round-trips preferences and recovers malformed local settings', () => {
  const selected = { source: { kind: 'artwork', id: 'painting' }, color: 'sage', frame: 'gilt', frameWidth: 'wide', caption: 'none' };
  expect(readWidgetSettings(JSON.stringify(selected))).toEqual(selected);
  for (const value of [undefined, 'null', 'invalid', '{"source":{"kind":"visit"}}']) expect(readWidgetSettings(value)).toEqual(defaultWidgetSettings);
  expect(widgetSettingsKey('account:one')).not.toBe(widgetSettingsKey('account:two'));
});
