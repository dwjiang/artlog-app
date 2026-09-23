import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import * as AppleAuthentication from "expo-apple-authentication";
import { useEffect, useRef, useState } from "react";

import { anonymousOwner, switchOwner } from "./owner-store";
import { setSetting } from "@/db/repos/settings";
import { socialErrorMessage } from "../../../shared/social/errors";
import { api } from "../../../convex/_generated/api";
import { signPayload } from "@/lib/attested-write";
import { convex } from "@/lib/convex-client";
import { signInAnonymously } from "@/lib/device-identity";
import { useDeviceReady } from "@/lib/use-device-ready";
import { addBreadcrumb, reportError } from "@/lib/observability";
import { completeJournalClaim, pauseCollectionSync, resumeCollectionSync } from "./collection-sync";

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
      .catch((cause: unknown) =>
        reportError(cause, "auth.apple_availability", { level: "warning" }),
      );
    return () => {
      active = false;
    };
  }, []);

  async function perform(
    name: "auth.apple_sign_in" | "auth.sign_out" | "auth.delete_account",
    operation: () => Promise<void>,
  ) {
    if (inFlight.current || !ready) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    addBreadcrumb(`${name}.start`);
    try {
      await pauseCollectionSync();
      await operation();
      addBreadcrumb(`${name}.success`);
    } catch (cause) {
      if (
        !(
          cause &&
          typeof cause === "object" &&
          "code" in cause &&
          cause.code === "ERR_REQUEST_CANCELED"
        )
      ) {
        reportError(cause, name);
        setError(
          socialErrorMessage(cause) ??
            "Couldn’t update your account. Check your connection and try again.",
        );
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
      resumeCollectionSync();
    }
  }

  const signInWithApple = () =>
    perform("auth.apple_sign_in", async () => {
      const { nonce } = await convex.mutation(api.devices.createChallenge, { purpose: "apple" });
      const credential = await AppleAuthentication.signInAsync({
        nonce,
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) throw new Error("Apple did not return an identity token");
      await signIn("apple-native", { identityToken: credential.identityToken, nonce });
      const signed = await signPayload({ action: "linkAccount", appleUserId: credential.user });
      if (!signed) throw new Error("Device attestation is not ready");
      await convex.mutation(api.accounts.linkAccount, {
        appleUserId: credential.user,
        nonce: signed.nonce,
        assertionBase64: signed.assertionBase64,
      });
    });

  const disconnect = (remove: boolean) =>
    perform(remove ? "auth.delete_account" : "auth.sign_out", async () => {
      if (account?.accountId) await completeJournalClaim(account);
      await convex.mutation(remove ? api.accounts.deleteAccount : api.accounts.unlink, {});
      switchOwner(anonymousOwner());
      await setSetting("activeJournalOwner", anonymousOwner());
      await endSession();
      await signInAnonymously(signIn);
    });

  return {
    account,
    available,
    busy,
    error,
    ready,
    signInWithApple,
    signOut: () => disconnect(false),
    deleteAccount: () => disconnect(true),
  };
}
