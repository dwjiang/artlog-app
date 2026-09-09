import { api } from '../../convex/_generated/api';
import { stableStringify } from '../../shared/stable-stringify';

import { APP_ATTEST_KEY_ID, getAppAttest } from '@/lib/app-attest';
import { convex } from '@/lib/convex-client';
import { installationStorage } from '@/lib/installation-storage';

export type SignedPayload = { nonce: string; assertionBase64: string; payloadJson: string };

export async function signPayload(payload: object): Promise<SignedPayload | null> {
  const appAttest = getAppAttest();
  if (!appAttest) return null;

  const payloadJson = stableStringify(payload);
  const keyId = await installationStorage.getItem(APP_ATTEST_KEY_ID);
  if (keyId === null) throw new Error('Device attestation is not ready');
  const { nonce } = await convex.mutation(api.devices.createChallenge, { purpose: 'assert' });
  const assertionBase64 = await appAttest.generateAssertion(keyId, `${nonce}.${payloadJson}`);
  return { nonce, assertionBase64, payloadJson };
}
