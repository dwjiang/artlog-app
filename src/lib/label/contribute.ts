import type { FunctionReturnType } from 'convex/server';
import { File, UploadType } from 'expo-file-system';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { contributionPayload } from '../../../shared/attested-payloads';
import type { PendingScan } from '@/db/schema';
import { signPayload } from '@/lib/attested-write';
import { convex } from '@/lib/convex-client';
import { captureFileUri } from '@/lib/files/photos';
import { errorMessage, isNetworkError } from '@/lib/network-error';
import { resolveWithLabel } from '@/lib/result/feedback';
import { removeFile, resizeCropForContribution } from './crop';
import { saveLabelDraft } from './draft';
import { differsFromFlow, toSubmittedFields, toVerifyInput, type LabelFormState } from './fields';
import { labelApi } from './label-deps';

export type ContributionOutcome = FunctionReturnType<typeof api.contributions.contribute>;

export type ContributeInput = {
  scanId: Id<'scans'>;
  capture: Pick<PendingScan, 'cropPath' | 'descriptors' | 'keypoints'>;
  state: LabelFormState;
  museumSearchUpdatedAt?: number;
};

export async function uploadCrop(uploadUrl: string, uri: string): Promise<Id<'_storage'>> {
  const response = await new File(uri).upload(uploadUrl, {
    httpMethod: 'POST', uploadType: UploadType.BINARY_CONTENT, headers: { 'Content-Type': 'image/jpeg' },
  });
  if (response.status < 200 || response.status >= 300) throw new Error(`Crop upload failed with HTTP ${response.status}`);
  const { storageId } = JSON.parse(response.body) as { storageId: Id<'_storage'> };
  return storageId;
}

/** Design §4.5: the fingerprint, the label fields and the consented crop leave the phone; the full photo never does. */
export async function contributeLabel({ scanId, capture, state, museumSearchUpdatedAt }: ContributeInput): Promise<ContributionOutcome> {
  const fields = toSubmittedFields(state);
  if (!fields) throw new Error('A title and an artist are required to share');
  await saveLabelDraft(scanId, state, museumSearchUpdatedAt);
  // A previous attempt may have verified edits before its upload failed.
  const scan = await convex.query(api.scans.get, { scanId });
  if (scan?.labelFlow?.stage !== 'verified' || differsFromFlow(state, scan.labelFlow)) {
    await labelApi.verifyLabel({ scanId, fields: toVerifyInput(state) });
  }
  const crop = await resizeCropForContribution(captureFileUri(capture.cropPath));
  try {
    const { uploadUrl } = await convex.mutation(api.contributions.requestCropUpload, {});
    const cropStorageId = await uploadCrop(uploadUrl, crop.uri);
    const signed = await signPayload(contributionPayload({ scanId, cropStorageId, fields }));
    if (!signed) throw new Error('This device can’t share contributions yet');
    const result = await convex.action(api.contributions.contribute, {
      scanId, descriptors: capture.descriptors, keypoints: capture.keypoints, fields, cropStorageId, consent: true,
      nonce: signed.nonce, assertionBase64: signed.assertionBase64,
    });
    resolveWithLabel(convex, scanId, result.contributionId);
    return result;
  } finally {
    removeFile(crop.uri);
  }
}

export function contributionErrorMessage(error: unknown): string {
  if (isNetworkError(error)) return 'No connection — try sharing when you’re back online';
  switch (errorMessage(error)) {
    case 'rate_limited': return 'Try again in a minute';
    case 'label_unverified':
    case 'field_mismatch': return 'Verify the label again before sharing';
    case 'invalid_scan': return 'This scan isn’t tied to a museum, so it can’t be shared';
    case 'This device can’t share contributions yet': return 'This device can’t share contributions yet';
    default: return 'Couldn’t share this work right now';
  }
}
