import { eq } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";

import { db } from "@/db/client";
import { recoverArtworkVisits, selectArtworkEncounters } from "@/db/repos/artwork-album";
import { getSavedWork, listSavedWorks } from "@/db/repos/saved-works";
import { setSetting } from "@/db/repos/settings";
import { settings, type ArtworkEncounter, type SavedWork } from "@/db/schema";
import { captureOwner, useLocalOwner } from "@/lib/account/owner-store";
import type { SavedCaptureContext } from "@/lib/capture/completion";
import { useRemovedWorkIds } from "@/lib/collection/pending-removals";
import { reportError } from "@/lib/observability";
import { showErrorToast, showToast } from "@/lib/ui/toast";
import { visitForSave } from "@/lib/venue/use-venue";
import type { CurrentVisit } from "@/lib/venue/venue-reducer";
import { calendarDate } from "@/shared/journal/limits";

import type { Id } from "../../../convex/_generated/dataModel";

type Save = Pick<SavedWork, "localId" | "savedAt" | "venueId" | "venueName">;

/** Saves the person said were not a visit; only today's are kept. */
const notAVisitKey = (owner: string) => `notAVisit:${owner}`;

function parseIds(value: string | undefined): string[] {
  try {
    const ids: unknown = JSON.parse(value ?? "[]");
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Today's saves, in the phone's time zone, that are in no visit and were not marked "Not a visit"; newest first. */
export function visitlessToday<T extends Save>(
  works: T[],
  encounters: Pick<ArtworkEncounter, "savedLocalId">[],
  dismissed: string[],
  now = Date.now(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): T[] {
  const today = calendarDate(now, timeZone);
  const inVisit = new Set(encounters.map((encounter) => encounter.savedLocalId));
  return works.filter(
    (work) =>
      !inVisit.has(work.localId) && !dismissed.includes(work.localId) && calendarDate(work.savedAt, timeZone) === today,
  );
}

/** The museum all the saves were made at, when they agree on one. */
export function sharedMuseum(works: Save[]): Pick<SavedWork, "venueId" | "venueName"> | undefined {
  const [first] = works;
  if (!first?.venueId || works.some((work) => work.venueId !== first.venueId)) return undefined;
  return { venueId: first.venueId, venueName: first.venueName };
}

/** Home's "saved today" card: today's saves that missed a visit, and "Not a visit" to set them aside for the day. */
export function useVisitlessSavesToday(owner: string) {
  const key = notAVisitKey(owner);
  const works = useLiveQuery(listSavedWorks(owner), [owner]);
  const encounters = useLiveQuery(selectArtworkEncounters(owner), [owner]);
  const setting = useLiveQuery(db.select().from(settings).where(eq(settings.key, key)), [key]);
  const removedIds = useRemovedWorkIds(owner);
  const error = works.error ?? encounters.error ?? setting.error;
  useEffect(() => {
    if (error) reportError(error, "journal.visitless-saves.load", { level: "warning" });
  }, [error]);
  const loaded = !!works.updatedAt && !!encounters.updatedAt && !!setting.updatedAt;
  const dismissed = parseIds(setting.data.find((row) => row.key === key)?.value);
  const saves =
    loaded && !error
      ? visitlessToday(
          works.data.filter((work) => work.owner === owner && !removedIds.includes(work.localId)),
          encounters.data.filter((encounter) => encounter.owner === owner),
          dismissed,
        )
      : [];
  function dismiss() {
    const today = new Set(visitlessToday(works.data, [], []).map((work) => work.localId));
    const ids = [...new Set([...dismissed.filter((id) => today.has(id)), ...saves.map((work) => work.localId)])];
    void setSetting(key, JSON.stringify(ids)).catch((cause: unknown) => {
      reportError(cause, "journal.visitless-saves.dismiss");
      showErrorToast("Couldn’t hide these artworks.");
    });
  }
  return { saves, dismiss };
}

/**
 * Files saves that missed a visit under the museum's visit for their day: the open one there, one already on the books,
 * or a new one spanning them.
 */
export async function addToMuseumVisit(
  venueId: Id<"museums">,
  works: (Pick<SavedWork, "localId" | "savedAt"> & { photoIds?: string[] })[],
  owner: string,
): Promise<CurrentVisit | undefined> {
  const session = captureOwner();
  if (owner !== session.owner) return undefined;
  let visit: CurrentVisit | undefined;
  const encounters: { savedId: string; visitId: string; photoIds?: string[] }[] = [];
  for (const work of [...works].sort((a, b) => a.savedAt - b.savedAt)) {
    visit = await visitForSave(venueId, work.savedAt, { past: true });
    if (!session.isOwnerCurrent()) return undefined;
    encounters.push({ savedId: work.localId, visitId: visit.localId, photoIds: work.photoIds });
  }
  recoverArtworkVisits(encounters, owner);
  return visit;
}

/**
 * "Make it a visit" for saves that missed one: files them at their museum, or at the museum the person picks when
 * location was off or the saves name none. `venueId` is that pick.
 */
export function useMakeVisit({ onAdded }: { onAdded?: () => void } = {}) {
  const router = useRouter();
  const owner = useLocalOwner();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  async function make(savedIds: string[], venueId?: Id<"museums">, capture?: SavedCaptureContext) {
    const session = captureOwner();
    if (pending.current || owner !== session.owner) return;
    pending.current = true;
    setBusy(true);
    try {
      const works = (await Promise.all(savedIds.map((id) => getSavedWork(id, owner)))).filter(
        (work): work is SavedWork => !!work && work.deletedAt === null,
      );
      if (!session.isOwnerCurrent() || works.length === 0) return;
      const museum = venueId ?? (capture ? capture.venueId : sharedMuseum(works)?.venueId);
      if (!museum) {
        router.push({
          pathname: "/add-to-visit",
          params: {
            savedIds: works.map((work) => work.localId).join(","),
            ...(capture ? { capturedAt: String(capture.capturedAt), photoIds: capture.photoIds.join(",") } : {}),
          },
        });
        return;
      }
      const visit = await addToMuseumVisit(
        museum,
        capture ? works.map((work) => ({ ...work, savedAt: capture.capturedAt, photoIds: capture.photoIds })) : works,
        owner,
      );
      if (!visit || !session.isOwnerCurrent()) return;
      showToast(`Added to your ${visit.venueName} visit.`);
      onAdded?.();
    } catch (cause) {
      if (!session.isOwnerCurrent()) return;
      reportError(cause, "visit.add-saves");
      showErrorToast("Couldn’t add to a visit.", () => void make(savedIds, venueId, capture));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return {
    busy,
    make: (savedIds: string[], venueId?: Id<"museums">, capture?: SavedCaptureContext) =>
      void make(savedIds, venueId, capture),
  };
}
