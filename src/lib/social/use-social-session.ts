import { useAuthToken } from "@convex-dev/auth/react";
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
  const deviceReady = useDeviceReady();
  const network = useNetworkState();
  const offline = isOffline(network);
  const key = `${generation}:${offline ? "offline" : "online"}:${deviceReady && !!token}`;
  const account = useSocialQuery(api.accounts.me, deviceReady && !offline ? {} : "skip", key);
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
    refresh: account.refresh,
  };
}
export type SocialSession = ReturnType<typeof useSocialSession>;
