import { View } from 'react-native';
import { ThemedText as Text } from '@/components/themed-text';
import { GalleryButton } from '@/components/collection/gallery-button';
import { friendshipActions } from '@/lib/social/presentation';
import type { FriendshipAction, PublicProfile } from '@/lib/social/types';
import { useFriendship } from '@/lib/social/use-friendship';
import type { SocialSession } from '@/lib/social/use-social-session';
import { socialStyles } from './social-styles';
import { router } from 'expo-router';
import { signInRoute } from '@/lib/account/sign-in-context';

const labels: Record<FriendshipAction, string> = {
  request: 'Add friend', accept: 'Accept request', decline: 'Decline', cancel: 'Cancel request', remove: 'Remove friend',
};

export function FriendshipControls({ profileId, session }: { profileId: PublicProfile['profileId']; session: SocialSession }) {
  const { state, busy, error, act, refresh } = useFriendship(profileId, session);
  if (session.status === 'signed-out' || session.status === 'profile-required') return <GalleryButton label="Add friend" variant="filled"
    onPress={() => router.push(session.status === 'signed-out' ? signInRoute('friends') : '/create-profile')} />;
  if (profileId === session.profileId || session.status !== 'ready') return null;
  return <View style={{ gap: 8 }}>
    {state && <Text style={socialStyles.caption}>{state.blocked ? 'This connection is unavailable.'
      : state.state === 'accepted' ? 'Friends' : state.state === 'pending'
        ? state.requesterId === session.profileId ? 'Friend request sent' : 'Wants to be your friend' : 'Share a love of art.'}</Text>}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      {state && friendshipActions(state, session.profileId!).map((action) => <GalleryButton key={action}
        label={labels[action]} disabled={busy} variant={action === 'request' || action === 'accept' ? 'filled' : 'outlined'}
        destructive={action === 'remove'} onPress={() => { void act(action); }} />)}
    </View>
    {busy && <Text style={socialStyles.caption}>Updating friendship…</Text>}
    {!state && !error && <Text style={socialStyles.caption}>Loading friendship…</Text>}
    {error && <>
      <Text selectable accessibilityRole="alert" style={socialStyles.body}>{error}</Text>
      <GalleryButton label="Refresh friendship" disabled={busy} onPress={refresh} />
    </>}
  </View>;
}
