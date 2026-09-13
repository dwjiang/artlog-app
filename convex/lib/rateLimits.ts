import { DAY, HOUR, MINUTE, RateLimiter, type RateLimitConfig } from '@convex-dev/rate-limiter';
import { ConvexError } from 'convex/values';

import { components } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx, MutationCtx } from '../_generated/server';

// Centralize rate-limit tuning here so callers share the same limits.
const limits = {
  registerDevice: { kind: 'fixed window', rate: 10, period: HOUR },
  attestChallenge: { kind: 'fixed window', rate: 30, period: HOUR },
  identify: { kind: 'token bucket', rate: 60, period: MINUTE, capacity: 20 },
  contribute: { kind: 'fixed window', rate: 20, period: HOUR },
  placementProposal: { kind: 'fixed window', rate: 20, period: HOUR },
  rejectPerWork: { kind: 'fixed window', rate: 3, period: DAY },
  venueConfirm: { kind: 'fixed window', rate: 5, period: DAY },
  labelRead: { kind: 'fixed window', rate: 30, period: HOUR },
  labelVerify: { kind: 'fixed window', rate: 60, period: HOUR },
  // Ten attempts: each is an exhibition search plus, without an image match, a description search.
  museumSearch: { kind: 'fixed window', rate: 20, period: HOUR },
  docent: { kind: 'fixed window', rate: 60, period: HOUR },
  rightNow: { kind: 'fixed window', rate: 60, period: HOUR },
  correctFact: { kind: 'fixed window', rate: 5, period: DAY },
  sync: { kind: 'token bucket', rate: 30, period: MINUTE, capacity: 10 },
} satisfies Record<string, RateLimitConfig>;

export type RateLimitName = keyof typeof limits;

export const limiter = new RateLimiter(components.rateLimiter, limits);

export async function limitKey(
  ctx: MutationCtx | ActionCtx,
  name: RateLimitName,
  key: string
): Promise<void> {
  const status = await limiter.limit(ctx, name, { key });
  if (!status.ok) {
    throw new ConvexError({ code: 'rate_limited', name, retryAfter: status.retryAfter });
  }
}

export async function limitDevice(
  ctx: MutationCtx | ActionCtx,
  name: RateLimitName,
  deviceId: Id<'devices'>,
  extraKey?: string
): Promise<void> {
  await limitKey(ctx, name, extraKey === undefined ? deviceId : `${deviceId}:${extraKey}`);
}
