import type { ConvexReactClient } from 'convex/react';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { rejectionPayload } from '../../../shared/attested-payloads';
import { signPayload } from '@/lib/attested-write';

/** Records "Not right?" as an attested rejection; `null` when this device cannot attest (design §4.6). */
export async function rejectMatch(
  client: Pick<ConvexReactClient, 'mutation'>,
  scanId: Id<'scans'>,
  objectId: Id<'objects'>,
): Promise<Id<'feedback'> | null> {
  const signed = await signPayload(rejectionPayload(scanId, objectId));
  if (!signed) return null;
  const { feedbackId } = await client.mutation(api.feedback.rejectMatch, {
    scanId, objectId, nonce: signed.nonce, assertionBase64: signed.assertionBase64,
  });
  return feedbackId;
}

export function resolveWithRunnerUp(
  client: Pick<ConvexReactClient, 'mutation'>,
  feedbackId: Id<'feedback'>,
  objectId: Id<'objects'>,
): Promise<null> {
  return client.mutation(api.feedback.resolveRejection, { feedbackId, resolution: { kind: 'runner_up', objectId } });
}
