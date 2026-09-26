import type { Visit } from "@/db/schema";
import countryNames from "@/shared/journal/country-names.json";
import { calendarDate } from "@/shared/journal/limits";

import { compareText, matchesSearch, searchTerm } from "./query";

export type JournalVisit = Visit & {
  city?: string | null;
  cityKey?: string | null;
  country?: string | null;
  regionKey?: string;
  regionName?: string;
};
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function countryName(code?: string | null): string {
  // Hermes does not implement Intl.DisplayNames; keep the English labels with the journal data.
  return code ? ((countryNames as Record<string, string>)[code] ?? code) : "";
}
export function formatVisitDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1].slice(0, 3)} ${year}`;
}
/** "2:10 PM" in the museum's time zone, or the day it began ("18 Sep 2026") for a visit still open from an earlier day. */
export function formatVisitStart(startedAt: number, timeZone: string, now = Date.now()): string {
  const day = calendarDate(startedAt, timeZone);
  if (day !== calendarDate(now, timeZone)) return formatVisitDate(day);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(startedAt);
}
export function filterVisits<T extends JournalVisit>(visits: T[], query = ""): T[] {
  const term = searchTerm(query);
  if (term === null) return [];
  if (!term) return visits;
  return visits.filter((visit) =>
    matchesSearch(
      [
        visit.venueName,
        visit.city,
        visit.country,
        countryName(visit.country),
        visit.regionName,
        visit.visitedOn,
        formatVisitDate(visit.visitedOn),
        MONTHS[Number(visit.visitedOn.slice(5, 7)) - 1],
      ],
      term,
    ),
  );
}
export function groupHistoryByMonth<T extends JournalVisit>(visits: T[]): { key: string; title: string; data: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const visit of [...visits].sort(
    (a, b) => compareText(b.visitedOn, a.visitedOn) || compareText(b.localId, a.localId),
  )) {
    const key = visit.visitedOn.slice(0, 7);
    const group = groups.get(key) ?? [];
    group.push(visit);
    groups.set(key, group);
  }
  return [...groups].map(([key, data]) => ({
    key,
    title: `${MONTHS[Number(key.slice(5)) - 1]} ${key.slice(0, 4)}`,
    data,
  }));
}

export type JournalSummary = {
  key: string;
  name: string;
  city?: string | null;
  country?: string | null;
  museumCount: number;
  visitCount: number;
  latestVisitedOn: string;
  venueIds: string[];
};

export function placeIdentity(visit: JournalVisit): {
  key: string;
  name: string;
} {
  if (visit.cityKey) {
    return { key: visit.cityKey, name: visit.city || visit.venueName };
  }
  if (visit.city) return { key: `venue:${visit.venueId}`, name: visit.city };
  if (visit.regionKey && visit.regionName) {
    return { key: visit.regionKey, name: visit.regionName };
  }
  if (visit.country) {
    return {
      key: `country:${visit.country}`,
      name: countryName(visit.country),
    };
  }
  return { key: `venue:${visit.venueId}`, name: visit.venueName };
}

export function summarizeJournal(visits: JournalVisit[], by: "museum" | "place"): JournalSummary[] {
  const groups = new Map<string, JournalSummary>();
  for (const visit of visits) {
    const { key, name } = by === "museum" ? { key: visit.venueId, name: visit.venueName } : placeIdentity(visit);
    const group = groups.get(key) ?? {
      key,
      name,
      city: visit.city,
      country: visit.country,
      museumCount: 0,
      visitCount: 0,
      latestVisitedOn: visit.visitedOn,
      venueIds: [],
    };
    group.visitCount++;
    if (!group.venueIds.includes(visit.venueId)) {
      group.venueIds.push(visit.venueId);
    }
    group.museumCount = group.venueIds.length;
    if (visit.visitedOn > group.latestVisitedOn) {
      group.latestVisitedOn = visit.visitedOn;
    }
    groups.set(key, group);
  }
  return [...groups.values()];
}
