import * as Location from "expo-location";
import { useEffect } from "react";
import { AppState, Linking } from "react-native";

import { reportError } from "@/lib/observability";
import { showErrorToast, showToast } from "@/lib/ui/toast";
import { useVenue, type LocationFailure, type VenueView } from "@/lib/venue/use-venue";

import type { ExploreData } from "./types";
import { chooseCity } from "./use-explore";

/** Tells the person why a tap on My location could not find the phone; Retry runs the same tap again. */
export function showLocationFailure(failure: LocationFailure, retry: () => void) {
  if (failure === "denied") {
    showToast("Allow location in Settings to show where you are.", {
      label: "Settings",
      onPress: () => void Linking.openSettings(),
    });
  } else {
    showErrorToast("Couldn’t find your location.", retry);
  }
}

const reportLocationError = (cause: unknown) => reportError(cause, "explore.location", { level: "warning" });

async function followPhone(resolve: VenueView["resolve"]) {
  chooseCity(undefined);
  const located = await resolve();
  if (located && "failure" in located) {
    showLocationFailure(located.failure, () => void followPhone(resolve).catch(reportLocationError));
  }
}

/**
 * The city menu's first row. With location on it follows the phone again; with it off it raises the iOS prompt, or
 * opens Settings once iOS won't ask again.
 */
export function useMyLocationAction({ following, home }: Partial<Pick<ExploreData, "following" | "home">>) {
  const { resolve } = useVenue();
  const [permission, requestPermission, getPermission] = Location.useForegroundPermissions();
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") getPermission().catch(reportLocationError);
    });
    return () => subscription.remove();
  }, [getPermission]);
  if (permission?.granted) {
    return {
      label: "My Location",
      icon: "location.fill",
      isOn: !!following,
      subtitle: home,
      onPress: () => void followPhone(resolve).catch(reportLocationError),
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
            await followPhone(resolve);
          });
      asking.catch(reportLocationError);
    },
  } as const;
}
