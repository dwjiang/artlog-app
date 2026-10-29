import * as AppIntegrity from "@expo/app-integrity";
import { AppState } from "react-native";

import { addBreadcrumb } from "./observability";

export const APP_ATTEST_KEY_ID = "appAttestKeyId";

export type AppAttest = {
  isSupported(): boolean;
  generateKey(): Promise<string>;
  /** Returns the base64 attestation object for `challenge`, hashed with SHA-256 on the device. */
  attestKey(keyId: string, challenge: string): Promise<string>;
  /** Returns the base64 assertion over `challenge`, hashed with SHA-256 on the device. */
  generateAssertion(keyId: string, challenge: string): Promise<string>;
};

function appState(): string {
  try {
    const state = AppState.currentState;
    return state === "active" || state === "inactive" || state === "background" ? state : "unknown";
  } catch {
    return "unknown";
  }
}

async function observeNativeCall<T>(
  operation: "generate_key" | "attest_key" | "generate_assertion",
  call: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  const stateBefore = appState();
  let stateChanges = 0;
  let memoryWarning = false;
  let lifecycle: ReturnType<typeof AppState.addEventListener> | undefined;
  let memory: ReturnType<typeof AppState.addEventListener> | undefined;
  try {
    lifecycle = AppState.addEventListener("change", () => {
      stateChanges = Math.min(stateChanges + 1, 100);
    });
  } catch {
    /* Native diagnostics are optional, including during app teardown. */
  }
  try {
    memory = AppState.addEventListener("memoryWarning", () => {
      memoryWarning = true;
    });
  } catch {
    /* The call must proceed even when memory notifications are unavailable. */
  }
  function record(phase: "start" | "success" | "failure"): void {
    try {
      const elapsed = phase === "start" ? 0 : Date.now() - started;
      addBreadcrumb(`auth.app_attest.${phase}`, {
        operation,
        elapsed_ms: Number.isFinite(elapsed) ? Math.min(Math.max(elapsed, 0), 300_000) : null,
        state_before: stateBefore,
        state_after: appState(),
        state_changes: stateChanges,
        memory_warning: memoryWarning,
        lifecycle_observed: lifecycle !== undefined,
        memory_observed: memory !== undefined,
      });
    } catch {
      /* Observation must not replace the result or error of a native security operation. */
    }
  }
  record("start");
  try {
    const value = await call();
    record("success");
    return value;
  } catch (error) {
    record("failure");
    throw error;
  } finally {
    for (const subscription of [lifecycle, memory]) {
      try {
        subscription?.remove();
      } catch {
        /* Teardown may have already removed a native subscription. */
      }
    }
  }
}

export function getAppAttest(): AppAttest | null {
  if (!AppIntegrity.isSupported) return null;
  return {
    isSupported: () => true,
    generateKey: () => observeNativeCall("generate_key", () => AppIntegrity.generateKeyAsync()),
    attestKey: (keyId, challenge) =>
      observeNativeCall("attest_key", () => AppIntegrity.attestKeyAsync(keyId, challenge)),
    generateAssertion: (keyId, challenge) =>
      observeNativeCall("generate_assertion", () => AppIntegrity.generateAssertionAsync(keyId, challenge)),
  };
}
