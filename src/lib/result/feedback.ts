import type { ConvexReactClient } from 'convex/react';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { rejectionPayload } from '../../../shared/attestation/attested-payloads';
import { signPayload } from '@/lib/attested-write';

const labelRejections = new Map<Id<'scans'>, Promise<Id<'feedback'> | null>>();

export function handOffLabelRejection(scanId: Id<'scans'>, rejection: Promise<Id<'feedback'> | null>): void {
  labelRejections.set(scanId, rejection);
}

export function resolveWithLabel(
  client: Pick<ConvexReactClient, 'mutation'>,
  scanId: Id<'scans'>,
  contributionId: Id<'contributions'>,
): void {
  const rejection = labelRejections.get(scanId);
  labelRejections.delete(scanId);
  // Feedback may still be waiting for signal; neither navigation nor sharing waits on it.
  void rejection?.then((feedbackId) => feedbackId && client.mutation(api.feedback.resolveRejection, {
    feedbackId, resolution: { kind: 'label', contributionId },
  })).catch((error: unknown) => console.warn('Could not resolve the rejection with this contribution', error));
}

/** Records "Not right?" as an attested rejection; `null` when this device cannot attest. */
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
