import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";

import type { JournalRepository } from "@/db/repos/journal";
import type * as saves from "@/db/repos/saved-works";
import type * as visits from "@/db/repos/visits";
import { visitInput } from "@/lib/journal/visit-payload";
import { type JournalSave, type JournalVisit, sameOwner } from "@/shared/journal/contracts";
import { LIMITS, utf8Bytes } from "@/shared/journal/limits";

import type { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

type SyncArgs = FunctionArgs<typeof api.sync.syncJournal>;
type SyncResult = FunctionReturnType<typeof api.sync.syncJournal>;
export type SyncContext = {
  scope: string;
  deviceId: Id<"devices">;
  accountId: Id<"accounts"> | null;
  owner: string;
};
export type SyncDependencies = Pick<typeof saves, "listUnsynced" | "markSynced" | "upsertFromRemote">
  & Pick<typeof visits, "listUnsyncedVisits" | "markVisitsSynced" | "upsertVisitsFromRemote">
  & Pick<JournalRepository, "applyVenues"> & {
    getCheckpoint: () => Promise<string | undefined>;
    setCheckpoint: (value: string) => Promise<void>;
    sync: (args: SyncArgs) => Promise<SyncResult>;
    removeUnreferencedPhotos: (paths: string[]) => Promise<void>;
  };
export async function syncJournal(deps: SyncDependencies, context: SyncContext, isCurrent = () => true): Promise<void> {
  const stored = await deps.getCheckpoint();
  let checkpoint = stored ? Number(stored) : 0;
  if (!Number.isSafeInteger(checkpoint) || checkpoint < 0) checkpoint = 0;
  while (isCurrent()) {
    const pendingVisits = await deps.listUnsyncedVisits(context.owner);
    const pendingSaves = await deps.listUnsynced(context.owner);
    if (!isCurrent()) return;
    const pushVisits: JournalVisit[] = [];
    const pushSaves: JournalSave[] = [];
    const fits = (input: JournalVisit | JournalSave) =>
      pushVisits.length + pushSaves.length < LIMITS.batchRecords
      && utf8Bytes({ visits: pushVisits, saves: pushSaves }) + utf8Bytes(input) < LIMITS.batchBytes - 1024;
    for (const row of pendingVisits) {
      const input = visitInput(row);
      if (!fits(input)) break;
      pushVisits.push(input);
    }
    for (const work of pendingSaves) {
      // Parents go first: saves wait for a batch that carries every pending visit.
      if (pendingVisits.length > pushVisits.length) break;
      const input: JournalSave = {
        localId: work.localId,
        visitLocalId: work.visitLocalId ?? undefined,
        snapshot: {
          title: work.title,
          artist: work.artist,
          date: work.date ?? undefined,
          medium: work.medium ?? undefined,
          institution: work.institution ?? undefined,
        },
        savedAt: work.savedAt,
        venueId: work.venueId ?? undefined,
        venueName: work.venueName ?? undefined,
        gallery: work.gallery ?? undefined,
        objectId: work.objectId ?? undefined,
        artworkId: work.artworkId ?? undefined,
        deletedAt: work.deletedAt ?? undefined,
      };
      if (!fits(input)) break;
      pushSaves.push(input);
    }
    const result = await deps.sync({
      visits: pushVisits,
      saves: pushSaves,
      since: checkpoint,
      scope: context.scope,
    });
    if (!isCurrent()) return;
    const expectedOwner = context.accountId
      ? { kind: "account" as const, accountId: context.accountId }
      : { kind: "device" as const, deviceId: context.deviceId };
    if ([...result.visits, ...result.saves].some((row) => !sameOwner(row.owner, expectedOwner))) {
      throw new ConvexError({ code: "not_found" });
    }
    await deps.applyVenues(result.venues);
    if (!isCurrent()) return;
    await deps.markVisitsSynced(
      result.acceptedVisits.map((ack) => ({
        ...ack,
        revision: pendingVisits.find((v) => v.localId === ack.localId)!.revision,
      })),
      context.owner,
    );
    if (!isCurrent()) return;
    await deps.markSynced(
      result.acceptedSaves.map((ack) => ({
        ...ack,
        revision: pendingSaves.find((work) => work.localId === ack.localId)!.revision,
      })),
      context.owner,
    );
    if (!isCurrent()) return;
    await deps.upsertVisitsFromRemote(result.visits, context.owner);
    if (!isCurrent()) return;
    await deps.removeUnreferencedPhotos(await deps.upsertFromRemote(result.saves, context.owner));
    if (!isCurrent()) return;
    checkpoint = result.checkpoint;
    await deps.setCheckpoint(String(checkpoint));
    if (
      !result.hasMore
      && (await deps.listUnsyncedVisits(context.owner)).length === 0
      && (await deps.listUnsynced(context.owner)).length === 0
    ) {
      return;
    }
  }
}
