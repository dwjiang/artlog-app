import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import * as AppleAuthentication from "expo-apple-authentication";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";

import { setSetting } from "@/db/repos/settings";
import { canAttest, signPayload } from "@/lib/attested-write";
import { convex } from "@/lib/convex-client";
import { resumeDeviceIdentity, signInAnonymously, suspendDeviceIdentity } from "@/lib/device-identity";
import { addBreadcrumb, reportError } from "@/lib/observability";
import { playErrorHaptic, playSuccessHaptic } from "@/lib/ui/haptics";
import { useDeviceReady } from "@/lib/use-device-ready";
import { socialErrorMessage } from "@/shared/social/errors";

import { api } from "../../../convex/_generated/api";
import { completeJournalClaim, pauseCollectionSync, resumeCollectionSync } from "./collection-sync";
import { eraseLocalData } from "./erase-local-data";
import { googleSignIn, googleSignInAvailable } from "./google-sign-in";
import { anonymousOwner, switchOwner } from "./owner-store";
import { offerProfileSetup } from "./profile-setup-offer";
import { carrySafetyChecksAnswer, takeSafetyChecksAnswer } from "./safety-checks-answer";

const isCancellation = (cause: unknown) =>
  !!cause && typeof cause === "object" && "code" in cause && cause.code === "ERR_REQUEST_CANCELED";

// Linking an account is an attested write, so refuse before the provider's sheet rather than after it.
function requireAttestation() {
  if (!canAttest()) throw new ConvexError({ code: "sign_in_unavailable" });
}

// Revoking Sign in with Apple needs a fresh authorization code. Cancelling keeps the account; any other
// failure still deletes it and leaves Artlog in the person's Sign in with Apple apps.
async function appleRevocationCode(): Promise<string | undefined> {
  try {
    return (await AppleAuthentication.signInAsync()).authorizationCode ?? undefined;
  } catch (cause) {
    if (isCancellation(cause)) throw cause;
    reportError(cause, "auth.apple_revocation_code", { level: "warning" });
    return undefined;
  }
}

export function useAccount() {
  const ready = useDeviceReady();
  const account = useQuery(api.accounts.me, ready ? {} : "skip");
  const { signIn, signOut: endSession } = useAuthActions();
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);
  useEffect(() => {
    let active = true;
    void AppleAuthentication.isAvailableAsync()
      .then((value) => {
        if (active) setAvailable(value);
      })
      .catch((cause: unknown) => reportError(cause, "auth.apple_availability", { level: "warning" }));
    return () => {
      active = false;
    };
  }, []);

  async function perform(
    name: "auth.apple_sign_in" | "auth.google_sign_in" | "auth.sign_out" | "auth.delete_account",
    operation: () => Promise<void | false>,
  ) {
    if (inFlight.current || !ready) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    addBreadcrumb(`${name}.start`);
    try {
      pauseCollectionSync();
      if ((await operation()) !== false) {
        addBreadcrumb(`${name}.success`);
        if (name === "auth.apple_sign_in" || name === "auth.google_sign_in") playSuccessHaptic();
      }
    } catch (cause) {
      if (!isCancellation(cause)) {
        playErrorHaptic();
        reportError(cause, name);
        setError(socialErrorMessage(cause) ?? "Couldn’t update your account. Check your connection and try again.");
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
      resumeCollectionSync();
    }
  }

  async function linkIdentity(provider: "apple" | "google", providerUserId: string, name?: string) {
    const identity = { provider, providerUserId };
    const signed = await signPayload({ action: "linkAccount", ...identity });
    if (!signed) throw new ConvexError({ code: "sign_in_unavailable" });
    const safetyChecksAnswer = await takeSafetyChecksAnswer();
    await convex.mutation(api.accounts.linkAccount, {
      ...identity,
      nonce: signed.nonce,
      assertionBase64: signed.assertionBase64,
    });
    await carrySafetyChecksAnswer(safetyChecksAnswer);
    offerProfileSetup(name ? { name } : {});
  }

  const signInWithApple = () =>
    perform("auth.apple_sign_in", async () => {
      requireAttestation();
      const { nonce } = await convex.mutation(api.devices.createChallenge, {
        purpose: "apple",
      });
      const credential = await AppleAuthentication.signInAsync({
        nonce,
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) {
        throw new Error("Apple did not return an identity token");
      }
      await signIn("apple-native", {
        identityToken: credential.identityToken,
        nonce,
      });
      const name = credential.fullName ? AppleAuthentication.formatFullName(credential.fullName).trim() : "";
      await linkIdentity("apple", credential.user, name);
    });

  const signInWithGoogle = () =>
    perform("auth.google_sign_in", async () => {
      requireAttestation();
      const credential = await googleSignIn();
      if (!credential) return false;
      const { nonce } = await convex.mutation(api.devices.createChallenge, { purpose: "google" });
      await signIn("google-native", { identityToken: credential.identityToken, nonce });
      await linkIdentity("google", credential.user, credential.name);
    });

  const signOut = () =>
    perform("auth.sign_out", async () => {
      if (account?.accountId) await completeJournalClaim(account);
      await convex.mutation(api.accounts.unlink, {});
      switchOwner(anonymousOwner());
      await setSetting("activeJournalOwner", anonymousOwner());
      await endSession();
      await Image.clearMemoryCache();
      await signInAnonymously(signIn);
    });

  // Guests and accounts alike: the server forgets this identity, then the phone continues as a fresh install.
  const deleteAccount = () =>
    perform("auth.delete_account", async () => {
      const appleAuthorizationCode = account?.provider === "apple" ? await appleRevocationCode() : undefined;
      if (account?.accountId) await completeJournalClaim(account);
      suspendDeviceIdentity();
      try {
        await convex.mutation(api.accounts.deleteAccount, { appleAuthorizationCode });
        await endSession();
        await eraseLocalData();
      } finally {
        resumeDeviceIdentity();
      }
      router.dismissAll();
      router.navigate("/");
    });

  return {
    account,
    available,
    googleAvailable: googleSignInAvailable,
    busy,
    error,
    ready,
    signInWithApple,
    signInWithGoogle,
    signOut,
    deleteAccount,
  };
}
