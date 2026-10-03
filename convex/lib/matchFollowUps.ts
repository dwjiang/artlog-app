import type { Scheduler } from "convex/server";

import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";

// Nothing on a named card waits for a model call; prose and "Right now" arrive through the scan subscription.
export async function scheduleMatchFollowUps(
  ctx: { scheduler: Scheduler },
  scan: Pick<Doc<"scans">, "_id" | "generation" | "venueId" | "deviceId">,
  artwork: Pick<Doc<"artworks">, "_id" | "artist" | "artistId">,
): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.docent.ensure, {
    artworkId: artwork._id,
    deviceId: scan.deviceId,
  });
  await ctx.scheduler.runAfter(0, internal.rightNow.fetch, {
    scanId: scan._id,
    generation: scan.generation,
    artistId: artwork.artistId,
    artist: artwork.artist,
    venueId: scan.venueId,
    deviceId: scan.deviceId,
  });
}
