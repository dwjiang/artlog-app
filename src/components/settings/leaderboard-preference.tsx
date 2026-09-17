import { useState } from 'react';
import { router } from 'expo-router';
import { signInRoute } from '@/lib/account/sign-in-context';
import { Text, View } from 'react-native';
import { api } from '../../../convex/_generated/api';
import { Gallery } from '@/constants/theme';
import { useSocialQuery } from '@/lib/social/use-social-query';
import { useSocialSession } from '@/lib/social/use-social-session';
import { GalleryButton } from '../collection/gallery-button';
import { LeaderboardParticipation, PARTICIPATION_LABELS } from '../social/leaderboard-participation';

export function LeaderboardPreference() {
  const session = useSocialSession();
  const preference = useSocialQuery(api.leaderboards.preference, session.status === 'ready' ? {} : 'skip', session.key);
  const [open, setOpen] = useState(false);
  return <View style={{ gap: 4 }}>
    <GalleryButton label="Leaderboard participation" icon="chevron.right" iconPosition="trailing" onPress={() => session.status === 'signed-out'
      ? router.push(signInRoute('leaderboards')) : setOpen(true)} />
    <Text style={{ color: Gallery.muted, fontSize: 11, lineHeight: 17 }}>{PARTICIPATION_LABELS[preference.data ?? 'off']} · identity and activity totals only</Text>
    {open && <LeaderboardParticipation onDismiss={() => setOpen(false)} />}
  </View>;
}
