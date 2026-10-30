import * as AppleAuthentication from "expo-apple-authentication";
import { AppState } from "react-native";

import { addBreadcrumb } from "@/lib/observability";

import { diagnosticAppState, signInPresentationSnapshot } from "../../../modules/sign-in-diagnostics/src";
import { presentWhenActive } from "./sign-in-presentation";

const failureCodes = new Set([
  "ERR_WINDOW_UNAVAILABLE",
  "ERR_REQUEST_FAILED",
  "ERR_REQUEST_NOT_HANDLED",
  "ERR_REQUEST_NOT_INTERACTIVE",
  "ERR_REQUEST_UNKNOWN",
  "ERR_INVALID_OPERATION",
  "ERR_INVALID_SCOPE",
]);

function errorCode(error: unknown): unknown {
  try {
    return error && typeof error === "object" && "code" in error ? error.code : undefined;
  } catch {
    // Do not inspect raw messages or native userInfo, which may contain account data.
    return undefined;
  }
}

export async function appleSignIn(
  purpose: "sign_in" | "revocation",
  options?: AppleAuthentication.AppleAuthenticationSignInOptions,
): Promise<AppleAuthentication.AppleAuthenticationCredential> {
  const started = Date.now();
  const data: Record<string, string | number | boolean | null> = { diagnostic_version: 2, purpose };
  const state = () => {
    try {
      return diagnosticAppState(AppState.currentState);
    } catch {
      return "unknown";
    }
  };
  const snapshot = async (phase: "before" | "after") => {
    try {
      for (const [key, value] of Object.entries(await signInPresentationSnapshot())) data[`${phase}_${key}`] = value;
    } catch {
      data[`${phase}_snapshot`] = "failed";
    }
    data[`${phase}_state`] = state();
  };
  const record = (phase: "start" | "success" | "failure") => {
    try {
      const elapsed = Date.now() - started;
      addBreadcrumb(`auth.apple_native.${phase}`, {
        ...data,
        elapsed_ms: Number.isFinite(elapsed) ? Math.min(600_000, Math.max(0, elapsed)) : null,
      });
    } catch {
      // Diagnostic failures must never change the authentication result.
    }
  };
  return presentWhenActive(
    async () => {
      await snapshot("before");
      record("start");
      try {
        const credential = await AppleAuthentication.signInAsync(options);
        record("success");
        return credential;
      } catch (error) {
        const code = errorCode(error);
        if (code !== "ERR_REQUEST_CANCELED") {
          data.error_code = typeof code === "string" && failureCodes.has(code) ? code : "unknown";
          await snapshot("after");
          record("failure");
        }
        throw error;
      }
    },
    (error) => errorCode(error) === "ERR_WINDOW_UNAVAILABLE",
    data,
  );
}
