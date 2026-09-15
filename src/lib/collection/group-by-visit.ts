import type { SavedWork, Visit } from '@/db/schema';
import { formatVisitDate } from '../journal/history';
import { compareText } from '../journal/query';

export type VisitSection = { key: string; title: string; monthTitle?: string; data: SavedWork[] };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "8 Sep 2026" in the device's time zone. */
export function formatDay(ms: number): string {
  const date = new Date(ms);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** Sections for a `SectionList`: newest visit first, keeping the works' order; works without a visit end under "Imported". */
export function groupByVisit(works: SavedWork[], visits: Visit[], includeEmpty = true): VisitSection[] {
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
    .sort((a, b) => compareText(b.visitedOn, a.visitedOn) || compareText(b.localId, a.localId))
    .flatMap((visit) => {
      const data = byVisit.get(visit.localId);
      return data || includeEmpty ? [{ key: visit.localId, title: `${visit.venueName} · ${formatVisitDate(visit.visitedOn)}`, data: data ?? [] }] : [];
    });
  if (imported.length) sections.push({ key: 'imported', title: 'Imported', data: imported });
  return sections;
}
