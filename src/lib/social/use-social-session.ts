import { useAuthToken } from "@convex-dev/auth/react";
import { useNetworkState } from "expo-network";
import { api } from "../../../convex/_generated/api";
import { useLocalOwner, useOwnerGeneration, useServerScope } from "../account/owner-store";
import { convexErrorCode } from "../network-error";
import { useDeviceReady } from "../use-device-ready";
import { useSocialQuery } from "./use-social-query";

export function useSocialSession() {
  const owner = useLocalOwner();
  const generation = useOwnerGeneration();
  const serverScope = useServerScope();
  const token = useAuthToken();
  const deviceReady = useDeviceReady();
  const network = useNetworkState();
  const offline = network.isConnected === false || network.isInternetReachable === false;
  const key = `${generation}:${offline ? "offline" : "online"}:${deviceReady && !!token}`;
  const account = useSocialQuery(api.accounts.me, deviceReady && !offline ? {} : "skip", key);
  const linked = account.data?.linked === true;
  const accountReady =
    linked &&
    !!token &&
    account.data?.scope === serverScope &&
    owner === `account:${account.data?.accountId}`;
  const mine = useSocialQuery(api.walls.getMine, accountReady && !offline ? {} : "skip", key);
  const profileRequired = convexErrorCode(mine.error) === "profile_required";
  const profileId =
    accountReady && mine.data?.scope === account.data?.scope ? mine.data?.profileId : undefined;
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
    refresh: () => {
      account.refresh();
      mine.refresh();
    },
  };
}
export type SocialSession = ReturnType<typeof useSocialSession>;
