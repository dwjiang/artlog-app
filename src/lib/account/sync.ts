import type { FunctionArgs, FunctionReturnType } from 'convex/server';

import type { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import type * as repository from '../../db/repos/saved-works';

type SyncArgs = FunctionArgs<typeof api.sync.syncCollection>;
type SyncResult = FunctionReturnType<typeof api.sync.syncCollection>;
export type SyncContext = { scope: string; deviceId: Id<'devices'>; accountId: Id<'accounts'> | null };
type Checkpoint = { scope: string; accountId: Id<'accounts'> | null; since: number; cursor?: SyncArgs['cursor'] };

export type SyncDependencies = Pick<typeof repository, 'listUnsynced' | 'markSynced' | 'upsertFromRemote' | 'queueAllForSync'> & {
  getCheckpoint: () => Promise<string | undefined>;
  setCheckpoint: (value: string) => Promise<void>;
  sync: (args: SyncArgs) => Promise<SyncResult>;
};

export async function syncCollection(deps: SyncDependencies, context: SyncContext, isCurrent = () => true): Promise<void> {
  const stored = await deps.getCheckpoint();
  let checkpoint: Checkpoint | undefined = stored ? JSON.parse(stored) : undefined;
  if (!isCurrent()) return;
  if (checkpoint && checkpoint.accountId !== context.accountId) await deps.queueAllForSync();
  if (checkpoint?.scope !== context.scope) checkpoint = { scope: context.scope, accountId: context.accountId, since: 0 };
  while (isCurrent()) {
    const pending = await deps.listUnsynced();
    if (!isCurrent()) return;
    const push: SyncArgs['push'] = pending.map(({ work, note }) => ({
      localId: work.localId,
      snapshot: {
        title: work.title, artist: work.artist, date: work.date ?? undefined,
        medium: work.medium ?? undefined, institution: work.institution ?? undefined,
      },
      savedAt: work.savedAt, venueId: work.venueId ?? undefined, venueName: work.venueName ?? undefined,
      gallery: work.gallery ?? undefined, objectId: work.objectId ?? undefined, artworkId: work.artworkId ?? undefined,
      note: note ?? undefined, deletedAt: work.deletedAt ?? undefined,
    }));
    const result = await deps.sync({ push, since: checkpoint.since, scope: context.scope, cursor: checkpoint.cursor });
    if (!isCurrent()) return;
    await deps.markSynced(result.accepted.map((accepted) => ({
      ...accepted, revision: pending.find(({ work }) => work.localId === accepted.localId)!.work.revision,
    })));
    if (!isCurrent()) return;
    await deps.upsertFromRemote(result.pulled);
    if (!isCurrent()) return;
    checkpoint = {
      scope: context.scope, accountId: context.accountId,
      since: result.cursor ? checkpoint.since : result.serverTime,
      ...(result.cursor ? { cursor: result.cursor } : {}),
    };
    await deps.setCheckpoint(JSON.stringify(checkpoint));
    if (!result.cursor && (await deps.listUnsynced()).length === 0) return;
  }
}
