import { useSyncExternalStore } from "react";

export type ProfileSetupOffer = { name?: string };

// Apple shares a person's name only on their first authorization, so it waits here until profile setup opens.
let offer: ProfileSetupOffer | undefined;
const listeners = new Set<() => void>();

function publish(next: ProfileSetupOffer | undefined) {
  offer = next;
  for (const listener of listeners) listener();
}

export function offerProfileSetup(next: ProfileSetupOffer): void {
  publish(next);
}

export function takeProfileSetupOffer(): ProfileSetupOffer | undefined {
  const taken = offer;
  if (taken) publish(undefined);
  return taken;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useProfileSetupOffer(): ProfileSetupOffer | undefined {
  return useSyncExternalStore(
    subscribe,
    () => offer,
    () => offer,
  );
}

export function profileSetupRoute(offer: ProfileSetupOffer, visitId?: string) {
  return {
    pathname: "/create-profile" as const,
    params: { ...(offer.name ? { name: offer.name } : {}), ...(visitId ? { visitId } : {}) },
  };
}
