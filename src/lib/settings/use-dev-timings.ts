import { useEffect, useState } from 'react';

import { getSetting, setSetting } from '@/db/repos/settings';
import { useScreenActive } from '@/hooks/use-screen-active';

export function useDevTimings() {
  const active = useScreenActive();
  const [enabled, setEnabled] = useState<boolean>();
  useEffect(() => {
    if (!__DEV__ || !active) return;
    let current = true;
    void getSetting('dev-timings').then(
      (value) => { if (current) setEnabled(value !== 'false'); },
      () => { if (current) setEnabled(undefined); },
    );
    return () => { current = false; };
  }, [active]);

  async function change(value: boolean) {
    await setSetting('dev-timings', String(value));
    setEnabled(value);
  }
  return { enabled, change };
}
