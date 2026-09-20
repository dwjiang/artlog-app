import { router } from 'expo-router';
import { api } from '../../../convex/_generated/api';
import { GroupedFooter, GroupedSection, NavigationRow } from '@/components/grouped-list';
import { signInRoute } from '@/lib/account/sign-in-context';
import { useSocialQuery } from '@/lib/social/use-social-query';
import { useSocialSession } from '@/lib/social/use-social-session';
import { PARTICIPATION_LABELS } from '../social/leaderboard-participation';

export function LeaderboardPreference({ onManage }: { onManage: () => void }) {
  const session = useSocialSession();
  const preference = useSocialQuery(api.leaderboards.preference, session.status === 'ready' ? {} : 'skip', session.key);
  const value = session.status === 'signed-out' ? 'Sign in' : session.status === 'profile-required' ? 'Create profile'
    : preference.data === undefined ? 'Loading…' : PARTICIPATION_LABELS[preference.data];
  return <GroupedSection footer={<GroupedFooter>Rankings show your identity and activity totals only. Museum names, visit dates, and notes stay private.</GroupedFooter>}>
    <NavigationRow label="Participation" value={value}
      onPress={() => session.status === 'signed-out' ? router.push(signInRoute('leaderboards')) : onManage()} />
  </GroupedSection>;
}
