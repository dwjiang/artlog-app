import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import * as AppleAuthentication from "expo-apple-authentication";
import { Image } from "expo-image";
import { useEffect, useRef, useState } from "react";

import { setSetting } from "@/db/repos/settings";
import { signPayload } from "@/lib/attested-write";
import { convex } from "@/lib/convex-client";
import { signInAnonymously } from "@/lib/device-identity";
import { addBreadcrumb, reportError } from "@/lib/observability";
import { useDeviceReady } from "@/lib/use-device-ready";
import { socialErrorMessage } from "@/shared/social/errors";

import { api } from "../../../convex/_generated/api";
import { completeJournalClaim, pauseCollectionSync, resumeCollectionSync } from "./collection-sync";
import { googleSignIn, googleSignInAvailable } from "./google-sign-in";
import { anonymousOwner, switchOwner } from "./owner-store";
import { offerProfileSetup } from "./profile-setup-offer";

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
      if ((await operation()) !== false) addBreadcrumb(`${name}.success`);
    } catch (cause) {
      if (!(cause && typeof cause === "object" && "code" in cause && cause.code === "ERR_REQUEST_CANCELED")) {
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
    if (!signed) throw new Error("Device attestation is not ready");
    await convex.mutation(api.accounts.linkAccount, {
      ...identity,
      nonce: signed.nonce,
      assertionBase64: signed.assertionBase64,
    });
    offerProfileSetup(name ? { name } : {});
  }

  const signInWithApple = () =>
    perform("auth.apple_sign_in", async () => {
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
      const credential = await googleSignIn();
      if (!credential) return false;
      const { nonce } = await convex.mutation(api.devices.createChallenge, { purpose: "google" });
      await signIn("google-native", { identityToken: credential.identityToken, nonce });
      await linkIdentity("google", credential.user, credential.name);
    });

  const disconnect = (remove: boolean) =>
    perform(remove ? "auth.delete_account" : "auth.sign_out", async () => {
      if (account?.accountId) await completeJournalClaim(account);
      await convex.mutation(remove ? api.accounts.deleteAccount : api.accounts.unlink, {});
      switchOwner(anonymousOwner());
      await setSetting("activeJournalOwner", anonymousOwner());
      await endSession();
      await Image.clearMemoryCache();
      await signInAnonymously(signIn);
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
    signOut: () => disconnect(false),
    deleteAccount: () => disconnect(true),
  };
}
