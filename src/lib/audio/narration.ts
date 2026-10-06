import type { Id } from "../../../convex/_generated/dataModel";
import type { FactChip } from "../../../convex/lib/validators";

export type ListeningWork = {
  artworkId: Id<"artworks">;
  title: string;
  artist: string;
  date?: string;
  imageUri?: string;
  savedId?: string;
  scanId?: string;
  facts: FactChip[];
  researchUpdatedAt?: number;
  opening: string;
  renderId?: string;
};
export type ListeningTrack = { work: ListeningWork };
/** How often the player reports its position while playing. */
export const PLAYBACK_UPDATE_MS = 250;
export function trackKey(track: ListeningTrack) {
  return track.work.artworkId;
}
// The research a track shows; saved progress and "now playing" only carry over while it is unchanged.
export function researchKey(track: ListeningTrack) {
  return JSON.stringify([track.work.opening, track.work.researchUpdatedAt]);
}
export function audioTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}
export function durationLabel(duration?: number) {
  return duration !== undefined && Number.isFinite(duration) && duration > 0 ? audioTime(duration) : undefined;
}
