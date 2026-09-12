import { useEffect, useState } from 'react';

import { useScreenActive } from '@/hooks/use-screen-active';
import { getSharingDefault, subscribeSharingDefault } from './sharing';

export function useSharingDefault() {
  const active = useScreenActive();
  const [value, setValue] = useState<boolean>();
  useEffect(() => {
    if (!active) return;
    let current = true;
    let revision = 0;
    const reload = () => {
      const request = ++revision;
      void getSharingDefault().then(
        (next) => { if (current && request === revision) setValue(next); },
        () => { if (current && request === revision) setValue(undefined); },
      );
    };
    reload();
    const unsubscribe = subscribeSharingDefault(reload);
    return () => { current = false; unsubscribe(); };
  }, [active]);
  return value;
}
