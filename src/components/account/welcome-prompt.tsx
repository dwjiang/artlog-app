import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { getSetting, setSetting } from '@/db/repos/settings';
import { useScreenActive } from '@/hooks/use-screen-active';
import type { SocialSession } from '@/lib/social/use-social-session';

export function WelcomePrompt({ status }: { status: SocialSession['status'] }) {
  const active = useScreenActive();
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (!active || checked || !['signed-out', 'ready', 'profile-required'].includes(status)) return;
    let cancelled = false;
    void (async () => {
      const seen = await getSetting('welcome-seen');
      if (cancelled) return;
      await setSetting('welcome-seen', 'true');
      if (cancelled) return;
      setChecked(true);
      if (seen !== 'true' && status === 'signed-out') router.push('/welcome');
    })().catch(() => { if (!cancelled) setChecked(true); });
    return () => { cancelled = true; };
  }, [active, checked, router, status]);
  return null;
}
