import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export type PlacementLike = {
  venueId: string;
  gallery?: string;
  onView: boolean;
  from?: number;
  to?: number;
  closedAt?: number;
  confidence: number;
  source: string;
};

const sourceRank: Record<string, number> = {
  manual: 6,
  feed: 5,
  checklist: 4,
  proposal: 3,
  contribution: 2,
  wikidata: 1,
};

export function currentPlacement<T extends PlacementLike>(placements: T[], now: number): T | null {
  let best: T | null = null;
  for (const placement of placements) {
    if (!isActive(placement, now)) continue;
    if (best === null || comparePlacements(placement, best) > 0) best = placement;
  }
  return best;
}

export async function loadCurrentPlacement(
  ctx: QueryCtx,
  objectId: Id<'objects'>,
  now: number
): Promise<Doc<'placements'> | null> {
  let placement: Doc<'placements'> | null = null;
  for await (const row of ctx.db.query('placements').withIndex('by_objectId', (q) => q.eq('objectId', objectId))) {
    placement = currentPlacement(placement ? [placement, row] : [row], now);
  }
  return placement;
}

function isActive(placement: PlacementLike, now: number): boolean {
  if (placement.closedAt !== undefined) return false;
  return (placement.from ?? -Infinity) <= now && now <= (placement.to ?? Infinity);
}

function comparePlacements(a: PlacementLike, b: PlacementLike): number {
  return (
    (sourceRank[a.source] ?? 0) - (sourceRank[b.source] ?? 0) ||
    a.confidence - b.confidence ||
    compareFrom(a.from, b.from)
  );
}

// An open-ended start sorts before any dated start.
function compareFrom(a: number | undefined, b: number | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  return a - b;
}
