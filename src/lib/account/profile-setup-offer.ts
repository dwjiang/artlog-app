import { useSyncExternalStore } from "react";

export type ProfileSetupOffer = { name?: string };

// Keep the sign-in provider’s suggested name until profile setup opens; Apple shares it only once.
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

export function profileSetupRoute(offer: ProfileSetupOffer, visitId?: string, audience?: "friends") {
  return {
    pathname: "/create-profile" as const,
    params: {
      ...(offer.name ? { name: offer.name } : {}),
      ...(visitId ? { visitId, ...(audience ? { audience } : {}) } : {}),
    },
  };
}
