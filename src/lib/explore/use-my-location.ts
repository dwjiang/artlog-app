import * as Location from "expo-location";
import { useEffect } from "react";
import { AppState, Linking } from "react-native";

import { reportError } from "@/lib/observability";
import { useVenue } from "@/lib/venue/use-venue";

import type { ExploreData } from "./types";
import { chooseCity } from "./use-explore";

/**
 * The city menu's first row. With location on it follows the phone again; with it off it raises the iOS prompt, or
 * opens Settings once iOS won't ask again.
 */
export function useMyLocationAction({ following, home }: Partial<Pick<ExploreData, "following" | "home">>) {
  const { resolve } = useVenue();
  const [permission, requestPermission, getPermission] = Location.useForegroundPermissions();
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        getPermission().catch((cause: unknown) => reportError(cause, "explore.location", { level: "warning" }));
      }
    });
    return () => subscription.remove();
  }, [getPermission]);
  const follow = async () => {
    chooseCity(undefined);
    await resolve();
  };
  const failed = (cause: unknown) => reportError(cause, "explore.location", { level: "warning" });
  if (permission?.granted) {
    return {
      label: "My Location",
      icon: "location.fill",
      isOn: !!following,
      subtitle: home,
      onPress: () => void follow().catch(failed),
    } as const;
  }
  const blocked = permission?.canAskAgain === false;
  return {
    label: "Use My Location",
    icon: "location",
    isOn: false,
    subtitle: blocked ? "Turn on in Settings" : undefined,
    onPress: () => {
      if (blocked) chooseCity(undefined);
      const asking = blocked
        ? Linking.openSettings()
        : requestPermission().then(async (answer) => {
            if (!answer.granted) return;
            await follow();
          });
      asking.catch(failed);
    },
  } as const;
}
