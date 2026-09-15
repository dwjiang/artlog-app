import { dateFromPicker, pickerDate, validVisitDate, venueTimeZone } from './visit-date';
import type { VenueRow } from '../venue/resolve';

it('round trips calendar dates without UTC conversion, including leap days', () => {
  for (const value of ['2024-02-29', '2026-03-08', '2026-11-01']) expect(dateFromPicker(pickerDate(value))).toBe(value);
});
it('rejects future dates using the museum day across the international date line', () => {
  const now = Date.parse('2026-09-15T10:30:00Z');
  expect(validVisitDate('2026-09-16', 'Pacific/Kiritimati', now)).toBe(true);
  expect(validVisitDate('2026-09-16', 'America/Los_Angeles', now)).toBe(false);
  expect(validVisitDate('2025-02-29', 'UTC', now)).toBe(false);
});
it('uses museum coordinates for its timezone', () => {
  expect(venueTimeZone({ lat: 40.7794, lng: -73.9632 } as VenueRow)).toBe('America/New_York');
});
