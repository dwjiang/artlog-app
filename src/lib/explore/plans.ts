import { useSyncExternalStore } from "react";

type Plans = { wantToSee: ReadonlySet<string>; reminders: ReadonlySet<string> };

// Held in memory until Explore has a backend to save them to.
let plans: Plans = { wantToSee: new Set(), reminders: new Set() };
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => plans;

export function usePlans(): Plans {
  return useSyncExternalStore(subscribe, snapshot);
}

function toggle(key: keyof Plans, id: string) {
  const next = new Set(plans[key]);
  if (!next.delete(id)) next.add(id);
  plans = { ...plans, [key]: next };
  for (const listener of listeners) listener();
}

export const toggleWantToSee = (exhibitionId: string) => toggle("wantToSee", exhibitionId);
export const toggleReminder = (exhibitionId: string) => toggle("reminders", exhibitionId);
