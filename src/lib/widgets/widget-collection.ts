import type { ArtworkEncounter, ArtworkPhoto, SavedWork, Visit } from "@/db/schema";

import type { WidgetSource } from "./widget-settings";

export type WidgetArtwork = {
  id: string;
  title: string;
  artist: string;
  paths: string[];
  visitId?: string;
  museum?: string;
  visitedOn?: string;
};
export type PreparedWidgetArtwork = WidgetArtwork & {
  uri: string;
  aspect: number;
};

export function widgetCollection(
  owner: string,
  works: SavedWork[],
  visits: Visit[],
  encounters: ArtworkEncounter[],
  photos: ArtworkPhoto[],
  source: WidgetSource,
): WidgetArtwork[] {
  const ownedVisits = new Map(visits.filter((visit) => visit.owner === owner).map((visit) => [visit.localId, visit]));
  return works
    .filter(
      (work) =>
        work.owner === owner && work.deletedAt === null && (source.kind !== "artwork" || work.localId === source.id),
    )
    .flatMap((work): WidgetArtwork[] => {
      const linked = encounters
        .filter(
          (encounter) =>
            encounter.owner === owner && encounter.savedLocalId === work.localId && encounter.deletedAt === null,
        )
        .map((encounter) => ownedVisits.get(encounter.visitLocalId))
        .filter((visit): visit is Visit => !!visit)
        .sort((a, b) => b.visitedOn.localeCompare(a.visitedOn) || a.localId.localeCompare(b.localId));
      const visit = source.kind === "visit" ? linked.find((row) => row.localId === source.id) : linked[0];
      if (source.kind === "visit" && !visit) return [];
      const album = photos
        .filter(
          (photo) =>
            photo.owner === owner
            && photo.savedLocalId === work.localId
            && photo.deletedAt === null
            && photo.kind === "full",
        )
        .sort(
          (a, b) =>
            Number(b.visitLocalId === visit?.localId) - Number(a.visitLocalId === visit?.localId)
            || a.capturedAt - b.capturedAt,
        );
      const paths = [
        ...new Set(
          [work.cropPath, ...album.map((photo) => photo.path), work.photoPath].filter((path): path is string => !!path),
        ),
      ];
      return [
        {
          id: work.localId,
          title: work.title,
          artist: work.artist,
          paths,
          visitId: visit?.localId,
          museum: visit?.venueName,
          visitedOn: visit?.visitedOn,
        },
      ];
    });
}

export function widgetArtworkUrl(artwork: Pick<WidgetArtwork, "id" | "visitId">): string {
  return `artlog://saved/${encodeURIComponent(artwork.id)}${artwork.visitId ? `?visitId=${encodeURIComponent(artwork.visitId)}` : ""}`;
}
