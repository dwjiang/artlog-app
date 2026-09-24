import { LIMITS } from "@/shared/journal/limits";

import type { SnapshotFields } from "../../../convex/lib/validators";
import type { ResultCandidate, ResultViewState } from "./state";

export const SNAPSHOT_FIELDS = ["title", "artist", "date", "medium", "institution"] as const;
export type SnapshotField = (typeof SNAPSHOT_FIELDS)[number];
/** The form's values: every field is a string while it is being edited. */
export type SnapshotDraft = Record<SnapshotField, string>;
export type Suggestion = { title: string; artist: string };

export function draftFromCandidate(candidate?: Pick<ResultCandidate, SnapshotField>): SnapshotDraft {
  return {
    title: candidate?.title ?? "",
    artist: candidate?.artist ?? "",
    date: candidate?.date ?? "",
    medium: candidate?.medium ?? "",
    institution: candidate?.institution ?? "",
  };
}

export function canSave(draft: SnapshotDraft): boolean {
  return Object.values(draft).every((value) => value.length <= LIMITS.snapshot);
}

function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * The saved snapshot and, for a confident card only, the server's suggestion so the backend can count an
 * untouched save as a confirm. A soft or chosen runner-up never counts, and a card without
 * a result (queued or unsupported) has nothing to suggest.
 */
export function buildSnapshot(
  draft: SnapshotDraft,
  view?: ResultViewState,
): { snapshot: SnapshotFields; suggested: Suggestion | null } {
  const snapshot: SnapshotFields = {
    title: draft.title.trim(),
    artist: draft.artist.trim(),
    date: optional(draft.date),
    medium: optional(draft.medium),
    institution: optional(draft.institution),
  };
  const suggested =
    view?.kind === "confident" && view.primary ? { title: view.primary.title, artist: view.primary.artist } : null;
  return { snapshot, suggested };
}
