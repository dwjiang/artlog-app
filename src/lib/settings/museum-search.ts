import { getSetting, setSetting } from "@/db/repos/settings";

export type MuseumSearchConsent = "unset" | "granted" | "declined";
const CONSENT_KEY = "museum-search-consent";
const listeners = new Set<(consent: MuseumSearchConsent) => void>();

export async function getMuseumSearchConsent(): Promise<MuseumSearchConsent> {
  const value = await getSetting(CONSENT_KEY);
  return value === "granted" || value === "declined" ? value : "unset";
}

export async function setMuseumSearchConsent(value: MuseumSearchConsent): Promise<void> {
  await setSetting(CONSENT_KEY, value);
  for (const listener of listeners) listener(value);
}

export function subscribeMuseumSearchConsent(listener: (consent: MuseumSearchConsent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
