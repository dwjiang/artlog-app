import { Alert, StyleSheet, View } from 'react-native';
import { Host, Icon, Row, Text as NativeText } from '@expo/ui';
import { Menu, Button } from '@expo/ui/swift-ui';
import { accessibilityLabel, buttonStyle, frame } from '@expo/ui/swift-ui/modifiers';
import { Gallery } from '@/constants/theme';
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

/**
 * The one-line control for list rows. A row the caller already knows is a friend renders without its own
 * relationship subscription, so the Friends list does not open one query per person.
 */
export function CompactFriendshipControls({ profileId, session, friend = false, onChanged }: { onChanged?: () => void; profileId: PublicProfile['profileId']; session: SocialSession; friend?: boolean }) {
  if (profileId === session.profileId) return null;
  if (friend) return <Text style={styles.friends}>Friends</Text>;
  if (session.status === 'signed-out' || session.status === 'profile-required') return <GalleryButton label="Add" variant="outlined" onPress={() => router.push(session.status === 'signed-out' ? signInRoute('friends') : '/create-profile')} />;
  if (session.status !== 'ready') return null;
  return <CompactFriendshipAction profileId={profileId} session={session} onChanged={onChanged} />;
}

function CompactFriendshipAction({ profileId, session, onChanged }: { onChanged?: () => void; profileId: PublicProfile['profileId']; session: SocialSession }) {
  const { state, busy, error, act, refresh } = useFriendship(profileId, session);
  const action = state?.state === 'pending' ? state.requesterId === session.profileId ? 'cancel' : 'accept' : 'request';
  return <View style={{ alignItems: 'flex-end', maxWidth: 150 }}>
    {state?.state === 'accepted' ? <Text style={styles.friends}>Friends</Text> : <GalleryButton variant="outlined" label={action === 'accept' ? 'Accept' : action === 'cancel' ? 'Requested' : 'Add'} disabled={busy || !state || state.blocked} onPress={() => { void act(action).then((changed) => { if (changed) onChanged?.(); }); }} />}
    {error && <GalleryButton label="Retry" onPress={refresh} />}
  </View>;
}

export function FriendshipControls({ profileId, session }: { profileId: PublicProfile['profileId']; session: SocialSession }) {
  const { state, busy, error, act, refresh } = useFriendship(profileId, session);
  if (session.status === 'signed-out' || session.status === 'profile-required') return <GalleryButton label="Add friend" variant="outlined" fullWidth
    onPress={() => router.push(session.status === 'signed-out' ? signInRoute('friends') : '/create-profile')} />;
  if (profileId === session.profileId || session.status !== 'ready') return null;
  return <View style={{ gap: 8 }}>
    {state && (state.blocked || (state.state !== 'accepted' && !(state.state === 'pending' && state.requesterId === session.profileId))) && <Text style={socialStyles.caption}>{state.blocked ? 'This connection is unavailable.'
      : state.state === 'pending'
        ? state.requesterId === session.profileId ? 'Friend request sent' : 'Wants to be your friend' : 'Share a love of art.'}</Text>}
    {state?.state === 'accepted' && !state.blocked ? <View style={{ borderWidth: 1, borderColor: Gallery.accent, borderRadius: 4 }}>
      <Host matchContents={{ vertical: true }} colorScheme="light" style={{ width: '100%' }}>
        <Menu modifiers={[accessibilityLabel('Friends'), buttonStyle('plain')]} label={<Row spacing={6} alignment="center" modifiers={[frame({ maxWidth: Infinity, minHeight: 44 })]}>
          <Row spacing={6} alignment="center" modifiers={[frame({ maxWidth: Infinity })]}><Icon name="checkmark" size={17} color={Gallery.accent} /><NativeText textStyle={{ color: Gallery.accent, fontSize: 17 }}>Friends</NativeText></Row>
          <Icon name="chevron.down" size={12} color={Gallery.accent} modifiers={[frame({ width: 32 })]} />
        </Row>}><Button label="Share profile" onPress={() => router.push({ pathname: '/share-profile', params: { profileId } })} /><Button label="Remove friend" role="destructive" onPress={() => { if (!busy) Alert.alert('Remove this friend?', 'You will no longer see each other’s friends-only activity. Public walls remain visible.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove friend', style: 'destructive', onPress: () => { void act('remove'); } }]); }} /></Menu>
      </Host>
    </View> : <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      {state?.state === 'pending' && state.requesterId === session.profileId && <GalleryButton label="Request sent" icon="checkmark" variant="outlined" fullWidth disabled onPress={() => {}} />}
      {state && friendshipActions(state, session.profileId!).map((action) => <GalleryButton key={action}
        label={labels[action]} disabled={busy} variant={action === 'request' || action === 'accept' ? 'filled' : 'outlined'}
        destructive={action === 'remove'} onPress={() => { void act(action); }} />)}
    </View>}
    {busy && <Text style={socialStyles.caption}>Updating friendship…</Text>}
    {!state && !error && <Text style={socialStyles.caption}>Loading friendship…</Text>}
    {error && <>
      <Text selectable accessibilityRole="alert" style={socialStyles.body}>{error}</Text>
      <GalleryButton label="Refresh friendship" disabled={busy} onPress={refresh} />
    </>}
  </View>;
}

const styles = StyleSheet.create({ friends: { color: Gallery.muted, fontSize: 13 } });
