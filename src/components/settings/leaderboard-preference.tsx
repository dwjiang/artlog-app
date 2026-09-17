import { useState } from 'react';
import { router } from 'expo-router';
import { signInRoute } from '@/lib/account/sign-in-context';
import { api } from '../../../convex/_generated/api';
import { useSocialQuery } from '@/lib/social/use-social-query';
import { useSocialSession } from '@/lib/social/use-social-session';
import { LeaderboardParticipation, PARTICIPATION_LABELS } from '../social/leaderboard-participation';
import { SettingsRow } from './settings-row';

export function LeaderboardPreference() {
  const session = useSocialSession();
  const preference = useSocialQuery(api.leaderboards.preference, session.status === 'ready' ? {} : 'skip', session.key);
  const [open, setOpen] = useState(false);
  return <>
    <SettingsRow title="Leaderboards" detail={`${PARTICIPATION_LABELS[preference.data ?? 'off']} · identity and activity totals only`}
      onPress={() => session.status === 'signed-out' ? router.push(signInRoute('leaderboards')) : setOpen(true)} />
    {open && <LeaderboardParticipation onDismiss={() => setOpen(false)} />}
  </>;
}
