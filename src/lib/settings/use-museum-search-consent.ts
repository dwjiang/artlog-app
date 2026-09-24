import { useEffect, useState } from "react";

import {
  getMuseumSearchConsent,
  subscribeMuseumSearchConsent,
  type MuseumSearchConsent,
} from "./museum-search";

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
    let current = true;
    let revision = 0;
    const reload = () => {
      const request = ++revision;
      void getMuseumSearchConsent().then(
        (consent) => {
          if (current && request === revision) {
            setState({ consent, failed: false });
          }
        },
        () => {
          if (current && request === revision) {
            setState({ consent: undefined, failed: true });
          }
        },
      );
    };
    reload();
    const unsubscribe = subscribeMuseumSearchConsent(reload);
    return () => {
      current = false;
      unsubscribe();
    };
  }, [active]);
  return state;
}
