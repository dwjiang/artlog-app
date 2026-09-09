import { useAuthActions } from '@convex-dev/auth/react';
import { useAction, useConvexAuth, useMutation } from 'convex/react';
import type { ReactAction, ReactMutation } from 'convex/react';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';

import { api } from '../../convex/_generated/api';

import { getAppAttest } from '@/lib/app-attest';
import { getDeviceAuthSecret } from '@/lib/device-credentials';

const APP_ATTEST_KEY_ID = 'appAttestKeyId';

type DeviceFunctions = {
  registerDevice: ReactMutation<typeof api.devices.registerDevice>;
  createChallenge: ReactMutation<typeof api.devices.createChallenge>;
  attestDevice: ReactAction<typeof api.devices.attestDevice>;
};

async function registerAndAttest(fns: DeviceFunctions): Promise<void> {
  const storedKeyId = await SecureStore.getItemAsync(APP_ATTEST_KEY_ID);
  const result = await fns.registerDevice({
    platform: Device.isDevice ? 'ios' : 'simulator',
    appAttestKeyId: storedKeyId ?? undefined,
  });
  const appAttest = getAppAttest();
  if (!result.attestRequired || result.attested || !appAttest?.isSupported()) return;

  const { nonce } = await fns.createChallenge({ purpose: 'attest' });
  const keyId = storedKeyId ?? (await appAttest.generateKey());
  await SecureStore.setItemAsync(APP_ATTEST_KEY_ID, keyId);
  const attestationBase64 = await appAttest.attestKey(keyId, nonce);
  await fns.attestDevice({ keyId, attestationBase64, nonce });
}

// Module-level so registration runs once per app launch even if the hook remounts.
let signInInFlight: Promise<unknown> | null = null;
let registration: Promise<void> | null = null;

export function useDeviceIdentity(): void {
  const [attempt, setAttempt] = useState(0);
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn } = useAuthActions();
  const registerDevice = useMutation(api.devices.registerDevice);
  const createChallenge = useMutation(api.devices.createChallenge);
  const attestDevice = useAction(api.devices.attestDevice);

  useEffect(() => {
    if (isLoading) return;
    let pending: Promise<unknown>;
    if (!isAuthenticated) {
      registration = null;
      signInInFlight ??= getDeviceAuthSecret()
        .then((secret) => signIn('anonymous', { secret }))
        .finally(() => {
          signInInFlight = null;
        });
      pending = signInInFlight;
    } else {
      registration ??= registerAndAttest({ registerDevice, createChallenge, attestDevice }).catch(
        (error: unknown) => {
          registration = null;
          throw error;
        }
      );
      pending = registration;
    }

    let active = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    void pending.catch((error: unknown) => {
      if (!active) return;
      console.warn('Device identity setup failed', error);
      retry = setTimeout(() => setAttempt((value) => value + 1), Math.min(1000 * 2 ** attempt, 30_000));
    });
    return () => {
      active = false;
      clearTimeout(retry);
    };
  }, [isAuthenticated, isLoading, signIn, registerDevice, createChallenge, attestDevice, attempt]);
}

export function DeviceIdentity(): null {
  useDeviceIdentity();
  return null;
}
