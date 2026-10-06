import { useNetworkState } from "expo-network";

import { isOffline } from "@/lib/network-state";
import { useDeviceReady } from "@/lib/use-device-ready";

/** Catalog queries need a registered device and a connection; `scope` resets their results when either changes. */
export function useCatalogReady() {
  const deviceReady = useDeviceReady();
  const offline = isOffline(useNetworkState());
  return { ready: deviceReady && !offline, offline, scope: `catalog:${deviceReady}:${offline}` };
}
