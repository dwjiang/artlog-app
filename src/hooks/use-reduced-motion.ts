import { useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";

let reduced = true;
const listeners = new Set<() => void>();
let stop: (() => void) | undefined;

function update(value: boolean) {
  if (reduced === value) return;
  reduced = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    let current = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      changed = true;
      update(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (current && !changed) update(value);
      })
      .catch(() => {});
    stop = () => {
      current = false;
      subscription.remove();
    };
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stop?.();
      stop = undefined;
      reduced = true;
    }
  };
}

const snapshot = () => reduced;

export function useReducedMotion() {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}
