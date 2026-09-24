import { useSyncExternalStore } from "react";

let installationOwner: string | undefined;
let activeOwner: string | undefined;
let serverScope: string | undefined;
let generation = 0;
let ownerGeneration = 0;
const listeners = new Set<() => void>();
const ownerListeners = new Set<() => void>();
export function initializeOwner(installationId: string, restoredOwner?: string): void {
  installationOwner = `device:${installationId}`;
  activeOwner = restoredOwner ?? installationOwner;
  ownerGeneration++;
  serverScope = undefined;
  generation++;
}
export function anonymousOwner(): string {
  if (!installationOwner) throw new Error("Journal owner is not initialized");
  return installationOwner;
}
export function getLocalOwner(): string {
  if (!activeOwner) throw new Error("Journal owner is not initialized");
  return activeOwner;
}
export function getServerScope(): string {
  if (!serverScope) throw new Error("Journal sync is not ready");
  return serverScope;
}
export function switchOwner(owner: string, scope?: string): void {
  if (owner === activeOwner && scope === serverScope) return;
  const changedOwner = activeOwner !== owner;
  activeOwner = owner;
  serverScope = scope;
  generation++;
  if (changedOwner) {
    ownerGeneration++;
    for (const listener of ownerListeners) listener();
  }
  for (const listener of listeners) listener();
}
export function captureOwner() {
  const owner = getLocalOwner(),
    version = generation,
    ownerVersion = ownerGeneration;
  return {
    owner,
    scope: serverScope,
    isCurrent: () => generation === version,
    isOwnerCurrent: () => ownerGeneration === ownerVersion,
  };
}
export function subscribeOwner(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function useLocalOwner(): string {
  return useSyncExternalStore(subscribeOwner, getLocalOwner, getLocalOwner);
}

export function useOwnerGeneration(): number {
  return useSyncExternalStore(
    subscribeOwner,
    () => generation,
    () => generation,
  );
}

export function useServerScope(): string | undefined {
  return useSyncExternalStore(
    subscribeOwner,
    () => serverScope,
    () => serverScope,
  );
}

export function subscribeOwnerChange(listener: () => void): () => void {
  ownerListeners.add(listener);
  return () => {
    ownerListeners.delete(listener);
  };
}
