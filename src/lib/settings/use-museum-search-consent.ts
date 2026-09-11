import { useEffect, useState } from 'react';

import { getMuseumSearchConsent, subscribeMuseumSearchConsent, type MuseumSearchConsent } from './museum-search';

export function useMuseumSearchConsent(active: boolean) {
  const [consent, setConsent] = useState<MuseumSearchConsent>();
  useEffect(() => {
    if (!active) return;
    let current = true;
    let revision = 0;
    const reload = () => {
      const request = ++revision;
      void getMuseumSearchConsent().then(
        (value) => { if (current && request === revision) setConsent(value); },
        () => { if (current && request === revision) setConsent(undefined); },
      );
    };
    reload();
    const unsubscribe = subscribeMuseumSearchConsent(reload);
    return () => { current = false; unsubscribe(); };
  }, [active]);
  return consent;
}
