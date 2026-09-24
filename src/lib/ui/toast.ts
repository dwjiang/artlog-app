import { useSyncExternalStore } from "react";

export type ToastAction = { label: string; onPress: () => void };
export type Toast = { id: number; message: string; action?: ToastAction };

const DURATION_MS = 4200;
let current: Toast | undefined;
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
