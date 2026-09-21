import { EmptyState } from '../empty-state';
import { Stack, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { NativeSegmentedPicker } from '../collection/native-segmented-picker';
import { GalleryButton } from '@/components/collection/gallery-button';
import { Gallery } from '@/constants/theme';
import { useCursorPages, useSocialQuery } from '@/lib/social/use-social-query';
import { useSocialSession } from '@/lib/social/use-social-session';
import type { SharedVisit } from '@/lib/social/types';
import { socialErrorMessage } from '@/shared/social/errors';
import { FriendshipControls } from './friendship-controls';
import { PageFooter, SocialGate, SocialState } from './social-state';
import { PublicProfileHeader, PublicWallView } from './public-wall-view';
import { VisitCard } from './visit-card';
import { socialStyles } from './social-styles';
import { ProfileSkeleton } from '@/components/loading-skeleton';

const visitPage = (page: { page: SharedVisit[]; cursor: string | null; isDone: boolean }) => page;
const visitId = (visit: SharedVisit) => visit.postId;

export function ProfileScreen({ profileId }: { profileId: string }) {
  const session = useSocialSession(), router = useRouter();
  const [tab, setTab] = useState<'wall' | 'visits'>('wall');
  const scroll = useRef<ScrollView>(null), offsets = useRef({ wall: 0, visits: 0 });
  const args = profileId && !session.offline ? { profileId: profileId as Id<'profiles'> } : 'skip';
  const profile = useSocialQuery(api.profiles.getPublic, args, session.key);
  const wall = useSocialQuery(api.walls.getPublic, profile.data ? args : 'skip', session.key);
  const relationship = useSocialQuery(api.friendships.getState, session.status === 'ready' && session.profileId !== profileId ? args : 'skip', session.key);
  const canReadVisits = !session.offline && !!profile.data && !relationship.data?.blocked;
  const visits = useCursorPages(api.sharedVisits.listByProfile, canReadVisits ? { profileId: profileId as Id<'profiles'> } : 'skip', session.key, visitPage, visitId);
  function changeTab(value: 'wall' | 'visits') { setTab(value); requestAnimationFrame(() => scroll.current?.scrollTo({ y: offsets.current[value], animated: false })); }
  if (session.offline) return <SocialGate session={session} />;
  if (!profileId || profile.data === null) return <SocialState title="Profile unavailable." detail="This public profile is no longer available." />;
  if (profile.error) return <SocialState title="Couldn’t load this profile." detail={socialErrorMessage(profile.error) ?? 'Please try again.'} action="Try again" onAction={profile.refresh} />;
  if (!profile.data) return <ScrollView style={socialStyles.root} contentInsetAdjustmentBehavior="automatic"><ProfileSkeleton /></ScrollView>;
  const person = profile.data;
  return <GestureHandlerRootView style={socialStyles.root}>
    <Stack.Screen options={{ title: '' }} />
    <Stack.Toolbar placement="right"><Stack.Toolbar.Button icon="square.and.arrow.up" accessibilityLabel="Share profile" tintColor={Gallery.ink} hidesSharedBackground
      onPress={() => router.push({ pathname: '/share-profile', params: { profileId: person.profileId } })}>Share</Stack.Toolbar.Button></Stack.Toolbar>
    <ScrollView ref={scroll} contentInsetAdjustmentBehavior="automatic" stickyHeaderIndices={[1]} scrollEventThrottle={100}
      onScroll={(event) => { offsets.current[tab] = event.nativeEvent.contentOffset.y; }} contentContainerStyle={{ paddingBottom: 30 }}>
      <View><PublicProfileHeader person={person} visitCount={visits.done ? visits.items.length : undefined}
        actions={session.profileId !== profileId ? <FriendshipControls key={`${session.key}:${profileId}`} profileId={person.profileId} session={session} /> : undefined}>
        {session.profileId === profileId && <GalleryButton label="Edit profile" variant="outlined" fullWidth onPress={() => router.push('/edit-profile')} />}
      </PublicProfileHeader></View>
      <View style={{ backgroundColor: Gallery.paper, paddingHorizontal: 20, paddingBottom: 12, paddingTop: 4 }}>
        <NativeSegmentedPicker label="Profile section" value={tab} onChange={changeTab}
          options={[{ value: 'wall', label: 'Wall' }, { value: 'visits', label: 'Visits' }]} />
      </View>
      {tab === 'wall' ? wall.error ? <SocialState title="Couldn’t load this wall." action="Try again" onAction={wall.refresh} />
        : wall.data ? <PublicWallView wall={wall.data} arrangedBy={person.name.split(' ')[0]} onSelect={(item) => router.push({ pathname: '/artwork', params: { kind: 'wall', itemId: item.itemId } })} /> : <SocialState title="Opening wall…" loading />
        : !canReadVisits ? <SocialState title="Visits aren’t available here." detail="Shared visits aren’t available for this profile." icon="lock" />
          : <View>{visits.items.map((visit) => <VisitCard key={visit.postId} visit={visit} token={session.token} showAuthor={false} />)}
            {visits.done && !visits.loading && !visits.items.length && !visits.error && <EmptyState title="No shared visits yet." detail={`When ${person.name.split(' ')[0]} shares a museum visit, it will appear here.`} />}
            <PageFooter {...visits} count={visits.items.length} />
          </View>}
    </ScrollView>
  </GestureHandlerRootView>;
}
