import { useEffect, useSyncExternalStore } from "react";

import { playErrorHaptic } from "./haptics";

export type ToastAction = { label: string; onPress: () => void };
/** `image` is a local file URI shown at the toast's leading edge, such as the artwork a toast confirms. */
export type Toast = { id: number; message: string; action?: ToastAction; image?: string };
export type ToastLift = { height: number; room: number };

const DURATION_MS = 4200;
let current: Toast | undefined;
let lift: (ToastLift & { owner: object }) | undefined;
let nextId = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
function emit() {
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => current;
const liftSnapshot = (): ToastLift | undefined => lift;

/** One confirmation at a time; a new message replaces the previous one and restarts the timer. */
export function showToast(message: string, action?: ToastAction, image?: string) {
  clearTimeout(timer);
  current = { id: ++nextId, message, action, image };
  emit();
  // Dismissal is scheduled only while a layer is showing the toast, so screens under test leave no timers behind.
  if (listeners.size > 0) {
    timer = setTimeout(() => dismissToast(current?.id), DURATION_MS);
  }
}

export function retryAction(onPress: () => void): ToastAction {
  return { label: "Retry", onPress };
}

/**
 * Failure toasts read “Couldn’t <do something>.” and offer Retry whenever the same operation can run again. Pass
 * `quiet` for failures the user didn't just cause, such as background work, so no error haptic plays.
 */
export function showErrorToast(message: string, onRetry?: () => void, { quiet = false } = {}) {
  if (!quiet) playErrorHaptic();
  showToast(message, onRetry && retryAction(onRetry));
}

export function dismissToast(id = current?.id) {
  if (!current || current.id !== id) return;
  clearTimeout(timer);
  timer = undefined;
  current = undefined;
  emit();
}
export function useToast() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * While `active`, floats toasts above a screen's own bottom bar of `height` points so they never cover its actions.
 * A bar raised off the bottom edge passes the `room` points under it, which keeps toasts that fit there.
 */
export function useLiftToasts(height: number | undefined, active: boolean, room = 0) {
  useEffect(() => {
    if (!active || !height) return;
    // Focus can move to the next screen before the previous one blurs; only the owner clears its lift.
    const owner = {};
    lift = { owner, height, room };
    emit();
    return () => {
      if (lift?.owner !== owner) return;
      lift = undefined;
      emit();
    };
  }, [height, room, active]);
}
export function useToastLift() {
  return useSyncExternalStore(subscribe, liftSnapshot, liftSnapshot);
}
