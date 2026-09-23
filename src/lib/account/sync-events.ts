const listeners = new Set<() => void>();

export function requestCollectionSync(): void {
  for (const listener of listeners) listener();
}

export function onCollectionChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
