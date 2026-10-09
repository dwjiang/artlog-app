import { getSetting, setSetting } from "@/db/repos/settings";
import { convex } from "@/lib/convex-client";
import { addBreadcrumb, reportError } from "@/lib/observability";

import { api } from "../../../convex/_generated/api";
import {
  applyVenueChanges,
  openVenueDb,
  readVenueTableMeta,
  VENUE_TABLE_CHECKED_AT,
  type VenueChanges,
  type VenueSnapshot,
} from "./venue-db";

const REFRESH_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

export type RefreshDependencies = {
  getCheckedAt(): Promise<number | undefined>;
  setCheckedAt(at: number): Promise<void>;
  localChangeVersion(): Promise<number>;
  fetchChanges(since: number): Promise<VenueChanges>;
  fetchSnapshot(cursor: string | null): Promise<VenueSnapshot>;
  applyChanges(changes: VenueChanges): Promise<void>;
  now(): number;
};

export type RefreshOutcome = "skipped" | "current" | "updated";

/** Fetches venues changed since the local table's checkpoint, at most once every 30 days. */
export async function refreshVenueTable(deps: RefreshDependencies): Promise<RefreshOutcome> {
  const now = deps.now();
  const checkedAt = await deps.getCheckedAt();
  if (checkedAt !== undefined && now - checkedAt < REFRESH_INTERVAL_MS) {
    return "skipped";
  }
  let since = await deps.localChangeVersion();
  let updated = false;
  if (since < 0) {
    let cursor: string | null = null;
    let checkpoint: number | undefined;
    do {
      const snapshot = await deps.fetchSnapshot(cursor);
      if (snapshot.cursor !== null && snapshot.cursor === cursor) {
        throw new Error("Venue snapshot did not advance");
      }
      // Catch up from the first page, including edits to rows already downloaded. An interrupted
      // snapshot keeps -1 and restarts from its first page; upserts make replay safe.
      checkpoint ??= snapshot.checkpoint;
      await deps.applyChanges({
        venues: snapshot.venues,
        checkpoint: snapshot.cursor === null ? checkpoint : -1,
        hasMore: snapshot.cursor !== null,
      });
      updated ||= snapshot.venues.length > 0;
      cursor = snapshot.cursor;
    } while (cursor !== null);
    since = checkpoint;
  }
  for (;;) {
    const changes = await deps.fetchChanges(since);
    if (changes.hasMore && changes.checkpoint <= since) {
      throw new Error(`Venue changes did not advance past ${since}`);
    }
    await deps.applyChanges(changes);
    updated ||= changes.venues.length > 0;
    since = changes.checkpoint;
    if (!changes.hasMore) break;
  }
  await deps.setCheckedAt(now);
  return updated ? "updated" : "current";
}

export const refreshDependencies: RefreshDependencies = {
  async getCheckedAt() {
    // Opening first lets a newly bundled table clear the check time before it is read.
    await openVenueDb();
    const value = await getSetting(VENUE_TABLE_CHECKED_AT);
    return value === undefined ? undefined : Number(value);
  },
  setCheckedAt: (at) => setSetting(VENUE_TABLE_CHECKED_AT, String(at)),
  localChangeVersion: async () => (await readVenueTableMeta(await openVenueDb())).changeVersion,
  fetchChanges: (since) => convex.query(api.venueChanges.list, { since }),
  fetchSnapshot: (cursor) => convex.query(api.venueChanges.snapshot, { cursor }),
  applyChanges: async (changes) => applyVenueChanges(await openVenueDb(), changes),
  now: Date.now,
};

let refreshing = false;
export function refreshVenueTableInBackground(): void {
  if (refreshing) return;
  refreshing = true;
  void refreshVenueTable(refreshDependencies)
    .then(
      (outcome) => {
        if (outcome === "updated") addBreadcrumb("venue.table.updated");
        if (__DEV__) console.debug("Venue table refresh", outcome);
      },
      (error: unknown) => {
        reportError(error, "venue.table.refresh", { level: "warning" });
        console.warn("Venue table refresh failed", error);
      },
    )
    .finally(() => {
      refreshing = false;
    });
}
