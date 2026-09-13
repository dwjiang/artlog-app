import { stableStringify } from './stable-stringify';

// The phone signs `nonce.payload` (src/lib/attested-write.ts) and requireAttestedWrite rebuilds the
// same string from the mutation arguments, so a signed request cannot be replayed with other data.
export function placementProposalPayload(scanId: string): string {
  return stableStringify({ operation: 'proposePlacement', scanId });
}

export function contributionPayload(input: { scanId: string; cropStorageId: string; fields: object }): string {
  return stableStringify({ operation: 'contribute', ...input });
}

export function rejectionPayload(scanId: string, objectId: string): string {
  return stableStringify({ operation: 'rejectMatch', scanId, objectId });
}
