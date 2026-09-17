import { Button, Column, Host, Icon, Row, Text as NativeText } from '@expo/ui';
import { accessibilityAddTraits, accessibilityLabel, frame } from '@expo/ui/swift-ui/modifiers';
import { useMutation } from 'convex/react';
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { api } from '../../../convex/_generated/api';
import { Gallery } from '@/constants/theme';
import { useSocialQuery } from '@/lib/social/use-social-query';
import { useSocialSession } from '@/lib/social/use-social-session';
import { showToast } from '@/lib/ui/toast';
import { GalleryButton } from '../collection/gallery-button';
import { LeaderboardSheet } from './leaderboard-sheet';
import { SocialGate, SocialState } from './social-state';

export type LeaderboardVisibility = 'off' | 'friends' | 'global';
export const PARTICIPATION_LABELS = { off: 'Off', friends: 'Friends only', global: 'Friends & Global' };
const modes = [
  { value: 'off', description: 'Browse rankings without appearing in them.' },
  { value: 'friends', description: 'Your connected friends can see your profile and both activity totals.' },
  { value: 'global', description: 'Anyone browsing Global can see your profile and both activity totals.' },
] as const;

export function LeaderboardParticipation({ onDismiss }: { onDismiss: () => void }) {
  const session = useSocialSession();
  const preference = useSocialQuery(api.leaderboards.preference, session.status === 'ready' ? {} : 'skip', session.key);
  const change = useMutation(api.leaderboards.setPreference);
  const [draft, setDraft] = useState<LeaderboardVisibility>();
  const [pending, setPending] = useState(false), [error, setError] = useState<string>();
  const saving = useRef(false);
  const value = draft ?? preference.data ?? 'off';
  async function save() {
    if (saving.current || preference.data === undefined) return;
    saving.current = true; setPending(true); setError(undefined);
    try {
      await change({ visibility: value });
      showToast(value === 'off' ? 'You’re off both leaderboards.' : value === 'friends' ? 'Your totals are shared with friends only.' : 'Your totals are shared on Friends & Global.');
      onDismiss();
    }
    catch { setError('Could not save participation. Try again.'); }
    finally { saving.current = false; setPending(false); }
  }
  return <LeaderboardSheet title="Participation" dismissLabel="Cancel" onDismiss={() => { if (!saving.current) onDismiss(); }}>
    <Text style={{ color: Gallery.ink, fontSize: 15, lineHeight: 22 }}>Who can see your leaderboard activity?</Text>
    {session.status === 'ready' ? <>
      <Host matchContents={{ vertical: true }} colorScheme="light" style={{ width: '100%' }}>
        <Column spacing={10}>
          {modes.map((mode) => <Button key={mode.value} variant="outlined" disabled={pending || preference.data === undefined}
            onPress={() => setDraft(mode.value)} style={{ padding: 14, borderRadius: 12 }}
            modifiers={[accessibilityLabel(PARTICIPATION_LABELS[mode.value]), accessibilityAddTraits(value === mode.value ? ['isSelected'] : []), frame({ maxWidth: Infinity })]}>
            <Row spacing={12} alignment="center" modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
              <Icon name={value === mode.value ? 'largecircle.fill.circle' : 'circle'} size={20} color={Gallery.accent} />
              <Column spacing={4} alignment="start" modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                <NativeText textStyle={{ fontSize: 14, fontWeight: '600', color: Gallery.ink }}>{PARTICIPATION_LABELS[mode.value]}</NativeText>
                <NativeText textStyle={{ fontSize: 12, color: Gallery.muted }}>{mode.description}</NativeText>
              </Column>
            </Row>
          </Button>)}
        </Column>
      </Host>
      {preference.loading && <SocialState title="Loading participation…" loading />}
      {preference.error && <SocialState title="Couldn’t load participation." action="Try again" onAction={preference.refresh} />}
    </> : <SocialGate session={session} />}
    <View style={{ padding: 16, backgroundColor: Gallery.fill, borderRadius: 12, gap: 10 }}>
      <Text style={{ color: Gallery.ink, fontSize: 14, fontWeight: '600' }}>Totals only. Not your visit history.</Text>
      <Text style={{ color: Gallery.muted, fontSize: 12, lineHeight: 19 }}>Joining shows your name, username, photo, rank, and counts of logged visits and accepted contributions, for this month and all time. Existing activity counts too, including private visits.</Text>
      <Text style={{ color: Gallery.muted, fontSize: 12, lineHeight: 19 }}>Museum names, visit dates, your globe, private notes, and artworks outside your wall stay private. Your public wall and visit-sharing choices don’t change.</Text>
    </View>
    {error && <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>{error}</Text>}
    {session.status === 'ready' && <GalleryButton label={pending ? 'Saving…' : 'Save participation'} fullWidth variant="filled"
      disabled={pending || preference.data === undefined} onPress={() => { void save(); }} />}
    <Text style={{ color: Gallery.muted, fontSize: 11, lineHeight: 17 }}>Participation starts off. You can switch it off at any time to leave both boards.</Text>
  </LeaderboardSheet>;
}
