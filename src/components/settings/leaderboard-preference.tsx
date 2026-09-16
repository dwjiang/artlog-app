import { useMutation } from 'convex/react';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { api } from '../../../convex/_generated/api';
import { Gallery } from '@/constants/theme';
import { useSocialQuery } from '@/lib/social/use-social-query';
import { useSocialSession } from '@/lib/social/use-social-session';
import { NativeSegmentedPicker } from '../collection/native-segmented-picker';
export function LeaderboardPreference() {
  const session = useSocialSession();
  const preference = useSocialQuery(api.leaderboards.preference, session.status === 'ready' ? {} : 'skip', session.key);
  const change = useMutation(api.leaderboards.setPreference);
  const [pending, setPending] = useState(false), [error, setError] = useState<string>();
  if (session.status !== 'ready') return null;
  return <View style={{ gap: 10 }}><Text style={{ color: Gallery.ink, fontSize: 14 }}>Leaderboards</Text>
    <NativeSegmentedPicker label="Leaderboard visibility" value={preference.data ?? 'off'} disabled={pending || preference.loading} options={[{ value: 'off', label: 'Off' }, { value: 'friends', label: 'Friends' }, { value: 'global', label: 'Global' }]} onChange={(visibility) => {
      setPending(true); setError(undefined); void change({ visibility }).then(preference.refresh).catch(() => setError('Could not save visibility. Try again.')).finally(() => setPending(false));
    }} />
    <Text style={{ color: Gallery.muted, fontSize: 11, lineHeight: 17 }}>Off by default. Friends shows your totals to friends; Global also includes you on the public leaderboard.</Text>
    {error && <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>{error}</Text>}
  </View>;
}
