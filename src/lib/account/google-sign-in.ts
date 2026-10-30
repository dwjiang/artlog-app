import { GoogleSignin, isCancelledResponse } from "@react-native-google-signin/google-signin";
import { AppState } from "react-native";

import { isTransientError } from "@/lib/network-error";
import { addBreadcrumb, reportError } from "@/lib/observability";

import { diagnosticAppState, signInPresentationSnapshot } from "../../../modules/sign-in-diagnostics/src";
import { googleSignInCancelled, googleSignInErrorData, googleSignInMissingWindow } from "./google-sign-in-diagnostics";
import { presentWhenActive } from "./sign-in-presentation";

const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

export const googleSignInAvailable = !!iosClientId && !!webClientId;

export async function googleSignIn() {
  const started = Date.now();
  const data: Record<string, string | number | boolean> = {
    diagnostic_version: 2,
    ios_client_configured: !!iosClientId,
    web_client_configured: !!webClientId,
    start_state: diagnosticAppState(AppState.currentState),
    lifecycle_changes: 0,
    saw_inactive: false,
    saw_background: false,
  };
  let stage = "configuration";
  let stageStarted = started;
  let subscription: ReturnType<typeof AppState.addEventListener> | undefined;
  const elapsed = (since: number) => Math.min(600_000, Math.max(0, Date.now() - since));
  const enter = (next: string) => {
    data[`${stage}_ms`] = elapsed(stageStarted);
    stage = next;
    stageStarted = Date.now();
  };
  try {
    try {
      subscription = AppState.addEventListener("change", (state) => {
        data.lifecycle_changes = Math.min(100, Number(data.lifecycle_changes) + 1);
        if (state === "inactive") data.saw_inactive = true;
        if (state === "background") data.saw_background = true;
      });
    } catch {
      data.lifecycle_listener_unavailable = true;
    }
    if (!googleSignInAvailable) throw new Error("Google sign-in is not configured");
    GoogleSignin.configure({ iosClientId, webClientId });
    enter("sign_out");
    // Clear the SDK's cached account so each explicit sign-in can choose a different person.
    await GoogleSignin.signOut();
    enter("active_wait");
    const result = await presentWhenActive(
      async () => {
        enter("presentation_snapshot");
        const before = await signInPresentationSnapshot();
        for (const [key, value] of Object.entries(before)) data[`before_${key}`] = value;
        data.before_state = diagnosticAppState(AppState.currentState);
        enter("native_sign_in");
        // The SDK also awaits its configuration promise here; this does not mean a sheet opened.
        return GoogleSignin.signIn();
      },
      googleSignInMissingWindow,
      data,
    );
    enter("response");
    if (isCancelledResponse(result)) {
      addBreadcrumb("auth.google_sign_in.cancelled");
      return null;
    }
    if (!result.data.idToken) throw new Error("Google did not return an identity token");
    addBreadcrumb("auth.google_sign_in.native_success", { ...data, elapsed_ms: elapsed(started) });
    return {
      identityToken: result.data.idToken,
      user: result.data.user.id,
      name: result.data.user.name?.trim(),
    };
  } catch (cause) {
    if (googleSignInCancelled(cause)) {
      addBreadcrumb("auth.google_sign_in.cancelled");
      return null;
    }
    // Preserve the shared reporter's existing offline/retry exclusions.
    if (isTransientError(cause)) throw cause;
    data.failed_stage = stage;
    data.stage_ms = elapsed(stageStarted);
    data.elapsed_ms = elapsed(started);
    data.failure_state = diagnosticAppState(AppState.currentState);
    Object.assign(data, googleSignInErrorData(cause));
    const after = await signInPresentationSnapshot();
    for (const [key, value] of Object.entries(after)) data[`after_${key}`] = value;
    // SDK descriptions interpolate NSError.userInfo, which can contain auth URLs or account
    // content. Report/rethrow the same sanitized error so useAccount's reporter deduplicates it.
    const error = new Error(
      stage === "configuration" && !googleSignInAvailable
        ? "Google sign-in is not configured"
        : stage === "response"
          ? "Google did not return an identity token"
          : "Google sign-in failed before identity exchange",
    );
    error.name = "GoogleSignInError";
    if (data.native_code && data.native_code !== "unknown") Object.assign(error, { code: data.native_code });
    reportError(error, "auth.google_sign_in", { data });
    throw error;
  } finally {
    try {
      subscription?.remove();
    } catch {
      /* Diagnostic cleanup must not replace an authentication result. */
    }
  }
}
