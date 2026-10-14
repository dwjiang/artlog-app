import { useAuthToken } from "@convex-dev/auth/react";
import { useNetworkState } from "expo-network";

import { useLocalOwner, useOwnerGeneration, useServerScope } from "@/lib/account/owner-store";
import { convexErrorCode } from "@/lib/network-error";
import { isOffline } from "@/lib/network-state";
import { useDeviceReady } from "@/lib/use-device-ready";

import { api } from "../../../convex/_generated/api";
import { useSocialQuery } from "./use-social-query";

export function useSocialSession() {
  const owner = useLocalOwner();
  const generation = useOwnerGeneration();
  const serverScope = useServerScope();
  const token = useAuthToken();
  const deviceReady = useDeviceReady();
  const network = useNetworkState();
  const offline = isOffline(network);
  const key = `${generation}:${offline ? "offline" : "online"}:${deviceReady && !!token}`;
  const account = useSocialQuery(api.accounts.me, deviceReady && !offline ? {} : "skip", key);
  const linked = account.data?.linked === true;
  const accountReady =
    linked && !!token && account.data?.scope === serverScope && owner === `account:${account.data?.accountId}`;
  const mine = useSocialQuery(api.walls.getMine, accountReady && !offline ? {} : "skip", key);
  const profileRequired = convexErrorCode(mine.error) === "profile_required";
  const profileId = accountReady && mine.data?.scope === account.data?.scope ? mine.data?.profileId : undefined;
  const error = account.error ?? (profileRequired ? undefined : mine.error);
  const status = offline
    ? "offline"
    : error
      ? "error"
      : !deviceReady || account.data === undefined
        ? "loading"
        : !linked
          ? "signed-out"
          : !accountReady
            ? "loading"
            : profileRequired
              ? "profile-required"
              : profileId
                ? "ready"
                : "loading";
  return {
    key,
    token,
    profileId,
    status,
    error,
    offline,
    accountReady,
    safetyChecks: account.data?.safetyChecks === true,
    refresh: () => {
      account.refresh();
      mine.refresh();
    },
  };
}
export type SocialSession = ReturnType<typeof useSocialSession>;
