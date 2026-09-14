import type { SavedWork, Visit } from '@/db/schema';

export type VisitSection = { key: string; title: string; data: SavedWork[] };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "8 Sep 2026" in the device's time zone. */
export function formatDay(ms: number): string {
  const date = new Date(ms);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** Sections for a `SectionList`: newest visit first, keeping the works' order; works without a visit end under "Imported". */
export function groupByVisit(works: SavedWork[], visits: Visit[]): VisitSection[] {
  const byVisit = new Map<string, SavedWork[]>();
  const imported: SavedWork[] = [];
  const known = new Map(visits.map((visit) => [visit.localId, visit]));
  for (const work of works) {
    const visit = work.visitLocalId ? known.get(work.visitLocalId) : undefined;
    if (!visit) {
      imported.push(work);
      continue;
    }
    const bucket = byVisit.get(visit.localId) ?? [];
    bucket.push(work);
    byVisit.set(visit.localId, bucket);
  }
  const sections = [...visits]
    .sort((a, b) => b.visitedOn.localeCompare(a.visitedOn) || b.localId.localeCompare(a.localId))
    .flatMap((visit) => {
      const data = byVisit.get(visit.localId);
      return data ? [{ key: visit.localId, title: `${visit.venueName} · ${formatDay(Date.parse(`${visit.visitedOn}T12:00:00`))}`, data }] : [];
    });
  if (imported.length) sections.push({ key: 'imported', title: 'Imported', data: imported });
  return sections;
}
