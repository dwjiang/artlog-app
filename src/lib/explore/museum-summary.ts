import { exhibitionsByTiming, isRunning } from "@/lib/explore/exhibition-timing";
import type { Exhibition, ExploreCatalog, ExploreMuseum } from "@/lib/explore/types";

/** Shows at a museum that are on or have not opened: running ones by closing date, then upcoming by opening date. */
export function museumExhibitions(data: ExploreCatalog, museum: ExploreMuseum): Exhibition[] {
  const here = data.exhibitions.filter((exhibition) => exhibition.museumId === museum.id);
  const running = here.filter((exhibition) => isRunning(exhibition, data.today));
  running.sort((a, b) => a.endsOn.localeCompare(b.endsOn));
  return [...running, ...exhibitionsByTiming(here, "upcoming", data.today)];
}

export const museumCover = (data: ExploreCatalog, museum: ExploreMuseum) => museumExhibitions(data, museum)[0]?.image;

/** "3 exhibitions · 1 ending soon": what's on at a museum now, counting shows that have not opened yet. */
export function museumSummary(data: ExploreCatalog, museum: ExploreMuseum): { count: string; ending?: string } {
  const current = museumExhibitions(data, museum);
  const ending = exhibitionsByTiming(current, "ending", data.today).length;
  return {
    count:
      current.length === 0
        ? "No exhibitions listed"
        : `${current.length} ${current.length === 1 ? "exhibition" : "exhibitions"}`,
    ending: ending > 0 ? `${ending} ending soon` : undefined,
  };
}

/** "1.2 mi · Berkeley": how far away the museum is, when known, and its city. */
export const museumLine = (museum: ExploreMuseum) => [museum.distance, museum.city].filter(Boolean).join(" · ");
