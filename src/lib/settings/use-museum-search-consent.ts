import { useEffect, useState } from "react";

import { getMuseumSearchConsent, subscribeMuseumSearchConsent, type MuseumSearchConsent } from "./museum-search";

/** `consent` stays undefined until the first read answers; `failed` marks a read that rejected so callers can stop waiting. */
export function useMuseumSearchConsent(active: boolean) {
  const [state, setState] = useState<{
    consent?: MuseumSearchConsent;
    failed: boolean;
  }>({
    failed: false,
  });
  useEffect(() => {
    if (!active) return;
    let reading = true;
    const unsubscribe = subscribeMuseumSearchConsent((consent) => {
      reading = false;
      setState({ consent, failed: false });
    });
    void getMuseumSearchConsent().then(
      (consent) => {
        if (reading) setState({ consent, failed: false });
      },
      () => {
        if (reading) setState({ consent: undefined, failed: true });
      },
    );
    return () => {
      reading = false;
      unsubscribe();
    };
  }, [active]);
  return state;
}
