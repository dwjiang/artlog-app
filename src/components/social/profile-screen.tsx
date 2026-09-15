import { socialStyles } from './social-styles';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SocialText as Text } from './social-text';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { WallGallery } from '@/components/collection/wall-gallery';
import { Gallery } from '@/constants/theme';
import { useSocialQuery } from '@/lib/social/use-social-query';
import { useSocialSession } from '@/lib/social/use-social-session';
import { socialErrorMessage } from '@/shared/social/errors';
import { FriendshipControls } from './friendship-controls';
import { SocialGate, SocialState } from './social-state';
import { ProfileIdentity } from './visit-card';

export function ProfileScreen({ profileId }: { profileId: string }) {
  const session = useSocialSession();
  const router = useRouter();
  const [width, setWidth] = useState(0);
  const args = profileId && !session.offline ? { profileId: profileId as Id<'profiles'> } : 'skip';
  const profile = useSocialQuery(api.profiles.getPublic, args, session.key);
  const wall = useSocialQuery(api.walls.getPublic, profile.data ? args : 'skip', session.key);
  const unavailable = !profileId || profile.data === null;
  const error = profile.error ?? wall.error;
  return <GestureHandlerRootView style={socialStyles.root}>
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={socialStyles.content}>
      {session.offline ? <SocialGate session={session} /> : unavailable ? <SocialState title="Profile unavailable."
        detail="This public profile is no longer available." /> : profile.error ? <SocialState title="Couldn’t load this profile."
          detail={socialErrorMessage(profile.error) ?? 'Please try again.'} action="Try again" onAction={profile.refresh} />
        : !profile.data ? <SocialState title="Opening profile…" loading /> : <>
          <View style={socialStyles.section}>
            <ProfileIdentity profile={profile.data} interactive={false} />
            {!!profile.data.bio && <Text selectable style={socialStyles.body}>{profile.data.bio}</Text>}
            <FriendshipControls key={`${session.key}:${profileId}`} profileId={profile.data.profileId} session={session} />
          </View>
          {session.status === 'signed-out' || session.status === 'profile-required' ? <SocialGate session={session} /> : null}
          <Text accessibilityRole="header" style={[socialStyles.title, { padding: 24 }]}>Public wall</Text>
          {error ? <SocialState title="Couldn’t load this wall." detail={socialErrorMessage(error) ?? 'Please try again.'}
            action="Try again" onAction={wall.refresh} /> : wall.data ? <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
              {width > 0 && <WallGallery width={width} color={wall.data.color}
                pieces={wall.data.items.map((item) => ({ localId: item.itemId, layout: item.layout, artwork: item.artwork }))}
                onSelect={(piece) => router.push({ pathname: '/artwork', params: { kind: 'wall', itemId: piece.localId } })}>
                {!wall.data.items.length && <View style={{ backgroundColor: Gallery.surface, margin: 24, borderRadius: 12 }}>
                  <SocialState title="A wall waiting for art." detail="No artworks have been hung here yet." />
                </View>}
              </WallGallery>}
            </View> : <SocialState title="Opening wall…" loading />}
        </>}
    </ScrollView>
  </GestureHandlerRootView>;
}
