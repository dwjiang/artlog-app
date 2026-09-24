import { getLocalOwner } from "@/lib/account/owner-store";
import type { Id } from "../../../convex/_generated/dataModel";
import { getSetting, removeSetting, setSetting } from "@/db/repos/settings";
import type { LabelFormState } from "./fields";

const key = (scanId: Id<"scans">, owner: string) =>
  `labelDraft:${owner}:${scanId}`;

type LabelDraft = { state: LabelFormState; museumSearchUpdatedAt?: number };

export async function loadLabelDraft(
  scanId: Id<"scans">,
  museumSearchUpdatedAt?: number,
  owner = getLocalOwner(),
): Promise<LabelFormState | undefined> {
  const stored = await getSetting(key(scanId, owner));
  if (stored === undefined) return;
  const draft = JSON.parse(stored) as LabelDraft;
  return draft.museumSearchUpdatedAt === museumSearchUpdatedAt
    ? draft.state
    : undefined;
}

// Keep the original values and unlocks before verification can replace the server's fields.
export function saveLabelDraft(
  scanId: Id<"scans">,
  state: LabelFormState,
  museumSearchUpdatedAt?: number,
  owner = getLocalOwner(),
): Promise<void> {
  return setSetting(
    key(scanId, owner),
    JSON.stringify({ state, museumSearchUpdatedAt } satisfies LabelDraft),
  );
}

export function clearLabelDraft(
  scanId: Id<"scans">,
  owner = getLocalOwner(),
): Promise<void> {
  return removeSetting(key(scanId, owner));
}
