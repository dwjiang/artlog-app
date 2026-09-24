import type { SavedWork } from "@/db/schema";

import { sortWorksByArtist } from "./search";

type ArtistWork = Pick<SavedWork, "localId" | "artist" | "title" | "date">;
export function artistSections<T extends ArtistWork>(works: T[]) {
  const groups = new Map<string, T[]>();
  for (const work of sortWorksByArtist(works)) {
    const initial = work.artist
      .trim()
      .normalize("NFD")
      .replaceAll(/[\u0300-\u036f]/g, "")
      .charAt(0)
      .toUpperCase();
    const title = /^[A-Z]$/.test(initial) ? initial : "#";
    groups.set(title, [...(groups.get(title) ?? []), work]);
  }
  return [...groups]
    .sort(([a], [b]) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b)))
    .map(([title, data]) => ({ key: title, title, data }));
}
