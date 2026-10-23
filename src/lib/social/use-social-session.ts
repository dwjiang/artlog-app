import { useAuthToken } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { useNetworkState } from "expo-network";

import { useLocalOwner, useOwnerIdentityGeneration } from "@/lib/account/owner-store";
import { isOffline } from "@/lib/network-state";
import { useDeviceReady } from "@/lib/use-device-ready";

import { api } from "../../../convex/_generated/api";
import { useSocialQuery } from "./use-social-query";

export function useSocialSession() {
  const owner = useLocalOwner();
  const generation = useOwnerIdentityGeneration();
  const token = useAuthToken();
  const { isAuthenticated } = useConvexAuth();
  const deviceReady = useDeviceReady();
  const network = useNetworkState();
  const offline = isOffline(network);
  const signedIn = isAuthenticated && !!token;
  const key = `${generation}:${offline ? "offline" : "online"}:${signedIn}`;
  // The account check answers before the device registers, so it goes out with the device check, not after it.
  const account = useSocialQuery(api.accounts.me, isAuthenticated && !offline ? {} : "skip", key);
  const linked = account.data?.linked === true;
  // Social reads need the finished sign-in claim, not the journal sync that reruns it on every launch.
  const accountReady =
    linked && !!token && account.data?.claimComplete === true && owner === `account:${account.data?.accountId}`;
  const profileId = accountReady ? (account.data?.profileId ?? undefined) : undefined;
  const status = offline
    ? "offline"
    : account.error
      ? "error"
      : !deviceReady || account.data === undefined
        ? "loading"
        : !linked
          ? "signed-out"
          : !accountReady
            ? "loading"
            : profileId
              ? "ready"
              : "profile-required";
  // While the startup checks are in flight, reads their answer will most likely allow can start so they arrive with
  // it; they render only once `status` allows them. A journal kept for an account most likely has a profile.
  const checking = status === "loading" && signedIn && (!deviceReady || account.data === undefined);
  const likelyProfile = account.data ? account.data.profileId !== null : owner.startsWith("account:");
  return {
    key: `${key}:${account.data?.scope ?? ""}`,
    scope: accountReady ? account.data?.scope : undefined,
    token,
    profileId,
    status,
    error: account.error,
    offline,
    accountReady,
    safetyChecks: account.data?.safetyChecks === true,
    prefetch: { public: checking, profile: checking && likelyProfile },
    refresh: account.refresh,
  };
}
export type SocialSession = ReturnType<typeof useSocialSession>;
