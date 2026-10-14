import { isClosed, isRunning, isUpcoming } from "./exhibition-timing";
import type { Exhibition, ExploreCatalog } from "./types";

const current = (data: ExploreCatalog, exhibition: Exhibition) =>
  isRunning(exhibition, data.today) || isUpcoming(exhibition, data.today);

/** Shows friends want to see that are on or still to open: most friends first, then the one closing soonest. */
export function friendPicks(data: ExploreCatalog): Exhibition[] {
  return data.exhibitions
    .filter((exhibition) => exhibition.friends.length > 0 && current(data, exhibition))
    .sort((a, b) => b.friends.length - a.friends.length || a.endsOn.localeCompare(b.endsOn));
}

/** Nearest first when the phone's location is known, else those listing shows first, then by name. */
export function nearbyMuseums(data: ExploreCatalog) {
  const showing = new Set(data.exhibitions.map((exhibition) => exhibition.museumId));
  return [...data.museums].sort(
    (a, b) =>
      (a.distanceM ?? 0) - (b.distanceM ?? 0)
      || Number(showing.has(b.id)) - Number(showing.has(a.id))
      || a.name.localeCompare(b.name),
  );
}

/**
 * Saved shows: those still on or ahead in the order they close, so the last chance comes first, then those that have
 * closed, most recent first.
 */
export function savedExhibitions(data: ExploreCatalog, ids: ReadonlySet<string>) {
  const saved = data.exhibitions.filter((exhibition) => ids.has(exhibition.id));
  return {
    current: saved.filter((exhibition) => current(data, exhibition)).sort((a, b) => a.endsOn.localeCompare(b.endsOn)),
    closed: saved
      .filter((exhibition) => isClosed(exhibition, data.today))
      .sort((a, b) => b.endsOn.localeCompare(a.endsOn)),
  };
}
