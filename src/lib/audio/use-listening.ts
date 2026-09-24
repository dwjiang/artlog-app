import { createContext, useContext, useSyncExternalStore } from "react";

import type { ListeningController } from "./listening-controller";

export const ListeningContext = createContext<ListeningController | null>(null);
function useController() {
  const controller = useContext(ListeningContext);
  if (!controller) throw new Error("ListeningProvider is missing");
  return controller;
}
export function useListening() {
  const controller = useController();
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  return { controller, ...state };
}
// Playback position updates four times a second; layout around the player only changes when a track loads or clears.
export function useHasListeningTrack() {
  const controller = useController();
  const loaded = () => !!controller.snapshot().current;
  return useSyncExternalStore(controller.subscribe, loaded, loaded);
}
