import { useAuthActions } from "@convex-dev/auth/react";
import { useAction, useConvexAuth, useMutation } from "convex/react";
import type { ReactAction, ReactMutation } from "convex/react";
import * as Device from "expo-device";
import { useEffect, useState } from "react";

import { api } from "../../convex/_generated/api";

import { APP_ATTEST_KEY_ID, getAppAttest } from "@/lib/app-attest";
import { getDeviceAuthSecret } from "@/lib/device-credentials";
import { installationStorage } from "@/lib/installation-storage";
import { addBreadcrumb, reportError } from "@/lib/observability";

type DeviceFunctions = {
  registerDevice: ReactMutation<typeof api.devices.registerDevice>;
  createChallenge: ReactMutation<typeof api.devices.createChallenge>;
  attestDevice: ReactAction<typeof api.devices.attestDevice>;
};

// Apple attests a key once. Keep its challenge and proof while retrying server submission.
let pendingAttestation: {
  deviceId: string;
  keyId: string;
  nonce: string;
  attestationBase64?: string;
} | null = null;

async function registerAndAttest(fns: DeviceFunctions): Promise<void> {
  addBreadcrumb("auth.device_registration.start");
  const storedKeyId = await installationStorage.getItem(APP_ATTEST_KEY_ID);
  const result = await fns.registerDevice({
    platform: Device.isDevice ? "ios" : "simulator",
    appAttestKeyId: storedKeyId ?? undefined,
  });
  const appAttest = getAppAttest();
  if (result.attested || !appAttest) {
    pendingAttestation = null;
    addBreadcrumb("auth.device_registration.success");
    return;
  }

  let keyId = storedKeyId;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (keyId === null) {
      keyId = await appAttest.generateKey();
      await installationStorage.setItem(APP_ATTEST_KEY_ID, keyId);
    }
    if (
      pendingAttestation?.keyId !== keyId
      || pendingAttestation.deviceId !== result.deviceId
    ) {
      const { nonce } = await fns.createChallenge({ purpose: "attest" });
      pendingAttestation = { deviceId: result.deviceId, keyId, nonce };
    }
    const request = pendingAttestation;
    try {
      request.attestationBase64 ??= await appAttest.attestKey(
        keyId,
        request.nonce,
      );
      await fns.attestDevice({
        keyId,
        attestationBase64: request.attestationBase64,
        nonce: request.nonce,
      });
      pendingAttestation = null;
      addBreadcrumb("auth.device_registration.success");
      return;
    } catch (error) {
      const code = errorCode(error);
      if (!requiresNewKey(code)) throw error;
      await installationStorage.removeItem(APP_ATTEST_KEY_ID);
      pendingAttestation = null;
      keyId = null;
      if (attempt === 1) throw error;
    }
  }
}

function requiresNewKey(code: string | undefined): boolean {
  return (
    code === "key_mismatch"
    || code === "invalid_attestation"
    || code === "challenge_invalid"
    || code === "ERR_APP_INTEGRITY_INVALID_KEY"
  );
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return;
  const data = "data" in error ? error.data : error;
  if (
    typeof data === "object"
    && data !== null
    && "code" in data
    && typeof data.code === "string"
  ) {
    return data.code;
  }
}

function canRetrySetup(error: unknown): boolean {
  const code = errorCode(error);
  if (requiresNewKey(code)) return false;
  // DeviceCheck configuration/key failures need investigation, not an endless loop of new keys.
  return (
    !code?.startsWith("ERR_APP_INTEGRITY_")
    || code === "ERR_APP_INTEGRITY_SERVER_UNAVAILABLE"
  );
}

// Module-level so registration runs once per app launch even if the hook remounts.
let signInInFlight: Promise<unknown> | null = null;
let registration: Promise<void> | null = null;

export function signInAnonymously(
  signIn: ReturnType<typeof useAuthActions>["signIn"],
): Promise<unknown> {
  signInInFlight ??= getDeviceAuthSecret()
    .then((secret) => signIn("anonymous", { secret }))
    .finally(() => {
      signInInFlight = null;
    });
  return signInInFlight;
}

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
      pendingAttestation = null;
      pending = signInAnonymously(signIn);
    } else {
      registration ??= registerAndAttest({
        registerDevice,
        createChallenge,
        attestDevice,
      }).catch((error: unknown) => {
        registration = null;
        throw error;
      });
      pending = registration;
    }

    let active = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    void pending.catch((error: unknown) => {
      if (!active) return;
      console.warn("Device identity setup failed", error);
      const retrying = canRetrySetup(error);
      reportError(
        error,
        isAuthenticated ? "auth.device_registration" : "auth.anonymous_sign_in",
        {
          data: { attempt: attempt + 1, retrying },
        },
      );
      if (!retrying) return;
      retry = setTimeout(
        () => setAttempt((value) => value + 1),
        Math.min(1000 * 2 ** attempt, 30_000),
      );
    });
    return () => {
      active = false;
      clearTimeout(retry);
    };
  }, [
    isAuthenticated,
    isLoading,
    signIn,
    registerDevice,
    createChallenge,
    attestDevice,
    attempt,
  ]);
}

export function DeviceIdentity(): null {
  useDeviceIdentity();
  return null;
}
