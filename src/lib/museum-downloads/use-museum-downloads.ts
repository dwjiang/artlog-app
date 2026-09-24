import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { addNetworkStateListener } from "expo-network";
import { useDeviceReady } from "@/lib/use-device-ready";
import { museumDownloads } from "./storage";

export function useMuseumDownloads() {
  const ready = useDeviceReady();
  const state = useSyncExternalStore(museumDownloads.subscribe, museumDownloads.getSnapshot);
  useEffect(() => {
    void museumDownloads.hydrate().catch((error) => console.warn("Could not read museum downloads", error));
    if (ready) {
      void museumDownloads.refresh().catch((error) => console.warn("Could not refresh museum downloads", error));
    }
  }, [ready]);
  return state;
}
export function MuseumDownloadLifecycle() {
  useEffect(() => {
    const pause = () => {
      void museumDownloads.pauseAll().catch((error) => console.warn("Could not pause downloads", error));
    };
    const app = AppState.addEventListener("change", (state) => {
      if (state === "background") pause();
    });
    const network = addNetworkStateListener((state) => {
      if (state.isConnected === false || state.isInternetReachable === false) {
        pause();
      }
    });
    return () => {
      pause();
      app.remove();
      network.remove();
    };
  }, []);
  return null;
}
