import { isRunning } from "./exhibition-timing";
import type { Exhibition, ExploreData } from "./types";

const current = (data: ExploreData, exhibition: Exhibition) =>
  isRunning(exhibition, data.today) || exhibition.startsOn > data.today;

/** Shows friends want to see that are on or still to open: most friends first, then the one closing soonest. */
export function friendPicks(data: ExploreData): Exhibition[] {
  return data.exhibitions
    .filter((exhibition) => exhibition.friends.length > 0 && current(data, exhibition))
    .sort((a, b) => b.friends.length - a.friends.length || a.endsOn.localeCompare(b.endsOn));
}

export const nearbyMuseums = (data: ExploreData) => [...data.museums].sort((a, b) => a.distanceMiles - b.distanceMiles);

/** Saved shows that have not closed, in the order they close, so the last chance comes first. */
export function savedExhibitions(data: ExploreData, ids: ReadonlySet<string>): Exhibition[] {
  return data.exhibitions
    .filter((exhibition) => ids.has(exhibition.id) && current(data, exhibition))
    .sort((a, b) => a.endsOn.localeCompare(b.endsOn));
}
