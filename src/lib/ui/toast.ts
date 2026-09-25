import { useEffect, useSyncExternalStore } from "react";

export type ToastAction = { label: string; onPress: () => void };
export type Toast = { id: number; message: string; action?: ToastAction };

const DURATION_MS = 4200;
let current: Toast | undefined;
let lift: { owner: object; height: number } | undefined;
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
const liftSnapshot = () => lift?.height ?? 0;

/** One confirmation at a time; a new message replaces the previous one and restarts the timer. */
export function showToast(message: string, action?: ToastAction) {
  clearTimeout(timer);
  current = { id: ++nextId, message, action };
  emit();
  // Dismissal is scheduled only while a layer is showing the toast, so screens under test leave no timers behind.
  if (listeners.size > 0) {
    timer = setTimeout(() => dismissToast(current?.id), DURATION_MS);
  }
}

export function retryAction(onPress: () => void): ToastAction {
  return { label: "Retry", onPress };
}

/** Failure toasts read “Couldn’t <do something>.” and offer Retry whenever the same operation can run again. */
export function showErrorToast(message: string, onRetry?: () => void) {
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

/** While `active`, floats toasts above a screen's own bottom bar of `height` points so they never cover its actions. */
export function useLiftToasts(height: number | undefined, active: boolean) {
  useEffect(() => {
    if (!active || !height) return;
    // Focus can move to the next screen before the previous one blurs; only the owner clears its lift.
    const owner = {};
    lift = { owner, height };
    emit();
    return () => {
      if (lift?.owner !== owner) return;
      lift = undefined;
      emit();
    };
  }, [height, active]);
}
export function useToastLift() {
  return useSyncExternalStore(subscribe, liftSnapshot, liftSnapshot);
}
