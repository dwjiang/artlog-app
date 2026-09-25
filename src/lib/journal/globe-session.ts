import { useSyncExternalStore } from "react";

import type { GlobeCamera } from "./globe-geometry";

type GlobeSession = { camera?: GlobeCamera };
const empty: GlobeSession = {};
const sessions = new Map<string, GlobeSession>();
const listeners = new Set<() => void>();
export function useGlobeSession(owner: string) {
  const state = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => sessions.get(owner) ?? empty,
  );
  function update(patch: GlobeSession) {
    sessions.set(owner, { ...sessions.get(owner), ...patch });
    for (const listener of listeners) listener();
  }
  return { ...state, update };
}
