import { isRunning, isUpcoming } from "./exhibition-timing";
import type { Exhibition, ExploreCatalog } from "./types";

const current = (data: ExploreCatalog, exhibition: Exhibition) =>
  isRunning(exhibition, data.today) || isUpcoming(exhibition, data.today);

/** Shows friends want to see that are on or still to open: most friends first, then the one closing soonest. */
export function friendPicks(data: ExploreCatalog): Exhibition[] {
  return data.exhibitions
    .filter((exhibition) => exhibition.friends.length > 0 && current(data, exhibition))
    .sort((a, b) => b.friends.length - a.friends.length || a.endsOn.localeCompare(b.endsOn));
}

/** Nearest first when the phone's location is known, else by name. */
export const nearbyMuseums = (data: ExploreCatalog) =>
  [...data.museums].sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0) || a.name.localeCompare(b.name));

/** Saved shows that have not closed, in the order they close, so the last chance comes first. */
export function savedExhibitions(data: ExploreCatalog, ids: ReadonlySet<string>): Exhibition[] {
  return data.exhibitions
    .filter((exhibition) => ids.has(exhibition.id) && current(data, exhibition))
    .sort((a, b) => a.endsOn.localeCompare(b.endsOn));
}
