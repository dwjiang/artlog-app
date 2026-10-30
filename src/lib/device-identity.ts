import { useAuthActions } from "@convex-dev/auth/react";
import { useAction, useConvexAuth, useMutation, useQuery, type ReactAction, type ReactMutation } from "convex/react";
import * as Device from "expo-device";
import { useEffect, useState, useSyncExternalStore } from "react";

import { APP_ATTEST_KEY_ID, getAppAttest } from "@/lib/app-attest";
import { forgetDeviceAuthSecret, getDeviceAuthSecret } from "@/lib/device-credentials";
import { installationStorage } from "@/lib/installation-storage";
import { rateLimitRetryAfterMs } from "@/lib/network-error";
import { addBreadcrumb, reportError } from "@/lib/observability";
import { reportIfStalled } from "@/lib/stall-report";

import { api } from "../../convex/_generated/api";

type DeviceFunctions = {
  registerDevice: ReactMutation<typeof api.devices.registerDevice>;
  createChallenge: ReactMutation<typeof api.devices.createChallenge>;
  attestDevice: ReactAction<typeof api.devices.attestDevice>;
};

// Setup runs one step at a time, so the current step names where a failure or hang happened.
let setupStep = "start";
const SETUP_STALL_MS = 60_000;

// Apple attests a key once. Keep its challenge and proof while retrying server submission.
let pendingAttestation: {
  deviceId: string;
  keyId: string;
  nonce: string;
  attestationBase64?: string;
} | null = null;

async function registerAndAttest(fns: DeviceFunctions): Promise<void> {
  addBreadcrumb("auth.device_registration.start");
  setupStep = "read_key";
  const storedKeyId = await installationStorage.getItem(APP_ATTEST_KEY_ID);
  setupStep = "register";
  const result = await fns.registerDevice({
    platform: Device.isDevice ? "ios" : "simulator",
    appAttestKeyId: storedKeyId ?? undefined,
  });
  const appAttest = getAppAttest();
  // Every backend this phone signs in to shares the saved key id, so attesting on one can overwrite the id another
  // already holds. The server attests one key per device, and that key remains on the phone.
  if (result.attestedKeyId !== undefined && result.attestedKeyId !== storedKeyId) {
    setupStep = "save_key";
    await installationStorage.setItem(APP_ATTEST_KEY_ID, result.attestedKeyId);
  }
  if (result.attested || result.attestedKeyId !== undefined || !appAttest) {
    pendingAttestation = null;
    addBreadcrumb("auth.device_registration.success");
    return;
  }

  let keyId = storedKeyId;
  let recoveredSystemFailure: unknown;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (keyId === null) {
        setupStep = "generate_key";
        keyId = await appAttest.generateKey();
        setupStep = "save_key";
        await installationStorage.setItem(APP_ATTEST_KEY_ID, keyId);
      }
      if (pendingAttestation?.keyId !== keyId || pendingAttestation.deviceId !== result.deviceId) {
        setupStep = "challenge";
        const { nonce } = await fns.createChallenge({ purpose: "attest" });
        pendingAttestation = { deviceId: result.deviceId, keyId, nonce };
      }
      const request = pendingAttestation;
      try {
        setupStep = "attest_key";
        request.attestationBase64 ??= await appAttest.attestKey(keyId, request.nonce);
        setupStep = "submit_attestation";
        await fns.attestDevice({
          keyId,
          attestationBase64: request.attestationBase64,
          nonce: request.nonce,
        });
        pendingAttestation = null;
        if (recoveredSystemFailure !== undefined) {
          reportError(recoveredSystemFailure, "auth.device_registration", { data: { recovered: true } });
        }
        addBreadcrumb("auth.device_registration.success");
        return;
      } catch (error) {
        const code = errorCode(error);
        if (!requiresNewKey(code)) throw error;
        await installationStorage.removeItem(APP_ATTEST_KEY_ID);
        pendingAttestation = null;
        keyId = null;
        if (attempt === 1) throw error;
        if (code === "ERR_APP_INTEGRITY_SYSTEM_FAILURE") {
          recoveredSystemFailure = error;
        }
      }
    }
  } catch (error) {
    if (recoveredSystemFailure !== undefined && errorCode(error) !== "ERR_APP_INTEGRITY_SYSTEM_FAILURE") {
      reportError(recoveredSystemFailure, "auth.device_registration", { data: { recovered: false } });
    }
    throw error;
  }
}

function requiresNewKey(code: string | undefined): boolean {
  return (
    code === "key_mismatch"
    || code === "invalid_attestation"
    || code === "challenge_invalid"
    || code === "ERR_APP_INTEGRITY_INVALID_KEY"
    || code === "ERR_APP_INTEGRITY_INVALID_INPUT"
    || code === "ERR_APP_INTEGRITY_SYSTEM_FAILURE"
  );
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return;
  const data = "data" in error ? error.data : error;
  if (typeof data === "object" && data !== null && "code" in data && typeof data.code === "string") {
    return data.code;
  }
}

function canRetrySetup(error: unknown): boolean {
  const code = errorCode(error);
  // A revoked session is replaced by signing in again, not by retrying registration with it.
  if (requiresNewKey(code) || code === "session_revoked") return false;
  // DeviceCheck configuration/key failures need investigation, not an endless loop of new keys.
  return !code?.startsWith("ERR_APP_INTEGRITY_") || code === "ERR_APP_INTEGRITY_SERVER_UNAVAILABLE";
}

// Module-level so registration runs once per app launch even if the hook remounts.
let signInInFlight: Promise<unknown> | null = null;
let registration: Promise<void> | null = null;

export function signInAnonymously(signIn: ReturnType<typeof useAuthActions>["signIn"]): Promise<unknown> {
  if (!signInInFlight) {
    setupStep = "read_secret";
    signInInFlight = reportIfStalled(
      getDeviceAuthSecret()
        .then((secret) => {
          setupStep = "sign_in";
          return signIn("anonymous", { secret });
        })
        .finally(() => {
          signInInFlight = null;
        }),
      "auth.anonymous_sign_in_stalled",
      SETUP_STALL_MS,
      { requiresNetwork: true, data: () => ({ step: setupStep }) },
    );
  }
  return signInInFlight;
}

// Erasing the installation holds identity setup so the retired secret is not signed straight back in.
let suspended = false;
const suspensionListeners = new Set<() => void>();

function setSuspended(value: boolean): void {
  suspended = value;
  for (const listener of suspensionListeners) listener();
}

export const suspendDeviceIdentity = () => setSuspended(true);
export const resumeDeviceIdentity = () => setSuspended(false);

function useSuspended(): boolean {
  return useSyncExternalStore(
    (listener) => {
      suspensionListeners.add(listener);
      return () => suspensionListeners.delete(listener);
    },
    () => suspended,
  );
}

/** The next sign-in creates a new secret and App Attest key, as on a fresh install. */
export async function forgetDeviceIdentity(): Promise<void> {
  pendingAttestation = null;
  await installationStorage.removeItem(APP_ATTEST_KEY_ID);
  await forgetDeviceAuthSecret();
}

export function useDeviceIdentity(): void {
  const [attempt, setAttempt] = useState(0);
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn, signOut } = useAuthActions();
  const registerDevice = useMutation(api.devices.registerDevice);
  const createChallenge = useMutation(api.devices.createChallenge);
  const attestDevice = useAction(api.devices.attestDevice);
  const paused = useSuspended();
  // Data deletion on any of the account's phones retires this device's user while its token is still valid.
  const revoked = useQuery(api.devices.sessionRevoked, isAuthenticated ? {} : "skip") === true;

  useEffect(() => {
    if (isLoading || paused) return;
    let pending: Promise<unknown>;
    if (!isAuthenticated) {
      registration = null;
      pendingAttestation = null;
      pending = signInAnonymously(signIn);
    } else if (revoked) {
      registration = null;
      setupStep = "revoked_sign_out";
      pending = signOut();
    } else {
      registration ??= reportIfStalled(
        registerAndAttest({ registerDevice, createChallenge, attestDevice }),
        "auth.device_registration_stalled",
        SETUP_STALL_MS,
        { requiresNetwork: true, data: () => ({ step: setupStep }) },
      ).catch((error: unknown) => {
        registration = null;
        throw error;
      });
      pending = registration;
    }

    let active = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    void pending.catch((error: unknown) => {
      if (!active || errorCode(error) === "session_revoked") return;
      console.warn("Device identity setup failed", error);
      const retrying = canRetrySetup(error);
      const operation = !isAuthenticated
        ? "auth.anonymous_sign_in"
        : revoked
          ? "auth.revoked_sign_out"
          : "auth.device_registration";
      reportError(error, operation, { data: { attempt: attempt + 1, retrying, step: setupStep } });
      if (!retrying) return;
      const delay = Math.max(Math.min(1000 * 2 ** attempt, 30_000), rateLimitRetryAfterMs(error) ?? 0);
      retry = setTimeout(() => setAttempt((value) => value + 1), delay);
    });
    return () => {
      active = false;
      clearTimeout(retry);
    };
  }, [
    isAuthenticated,
    isLoading,
    paused,
    revoked,
    signIn,
    signOut,
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
