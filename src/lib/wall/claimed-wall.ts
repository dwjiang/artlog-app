import { removeSetting } from "@/db/repos/settings";
import { flushCollectionMedia } from "@/lib/account/collection-sync";
import { captureOwner } from "@/lib/account/owner-store";
import { reportError } from "@/lib/observability";

import { privateWallKey, readPrivateWall } from "./local-wall-repository";
import type { WallDraft } from "./wall-layout";

type Repository = {
  getSnapshot: () => { acknowledged: { items: readonly unknown[] } | null; layoutDraft: unknown; pending: boolean };
  setLayoutDraft: (draft: WallDraft) => void;
  publishLayout: () => Promise<void>;
  discardDrafts: () => void;
};

let publishing: Promise<void> | undefined;

/**
 * Publishes the wall a guest arranged before signing in, once the account's wall has been read. An account wall that
 * already has art wins and the guest wall is dropped; a failed publish keeps it for the next read.
 */
export function publishClaimedWall(repository: Repository): Promise<void> {
  publishing ??= publish(repository)
    .catch((error: unknown) => reportError(error, "wall.claimed.publish"))
    .finally(() => {
      publishing = undefined;
    });
  return publishing;
}

async function publish(repository: Repository) {
  const session = captureOwner();
  if (!session.owner.startsWith("account:")) return;
  const wall = await readPrivateWall(session.owner);
  const { acknowledged, layoutDraft, pending } = repository.getSnapshot();
  if (!wall || !acknowledged || layoutDraft || pending || !session.isCurrent()) return;
  if (acknowledged.items.length === 0 && wall.items.length > 0) {
    repository.setLayoutDraft(wall);
    const draft = repository.getSnapshot().layoutDraft;
    try {
      // The claimed journal's first sync and uploads can take a while, so they finish before `pending` locks the wall.
      await flushCollectionMedia({
        photoLocalIds: wall.items.flatMap((item) => (item.photoLocalId ? [item.photoLocalId] : [])),
      });
      const current = repository.getSnapshot();
      // An owner change or closed screen meanwhile leaves the claim for the next read to settle.
      if (!session.isCurrent() || !current.acknowledged) return;
      // An edit meanwhile already carries the claimed pieces, so it replaces the claim even if it takes them all down.
      if (current.layoutDraft === draft) await repository.publishLayout();
    } catch (error) {
      if (session.isCurrent() && repository.getSnapshot().layoutDraft === draft) repository.discardDrafts();
      throw error;
    }
  }
  await removeSetting(privateWallKey(session.owner));
}
