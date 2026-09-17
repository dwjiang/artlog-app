import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SocialText as Text } from './social-text';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { GalleryIconButton } from '../collection/gallery-icon-button';
import { GalleryButton } from '@/components/collection/gallery-button';
import { Gallery } from '@/constants/theme';
import { useCursorPages, useSocialQuery } from '@/lib/social/use-social-query';
import { useSocialSession } from '@/lib/social/use-social-session';
import type { SharedVisit } from '@/lib/social/types';
import { socialErrorMessage } from '@/shared/social/errors';
import { FriendshipControls } from './friendship-controls';
import { PageFooter, SocialGate, SocialState } from './social-state';
import { PublicProfileHeader, PublicWallView } from './public-wall-view';
import { formatVisitDate } from '@/lib/journal/history';
import { socialStyles } from './social-styles';

const visitPage = (page: { page: SharedVisit[]; cursor: string | null; isDone: boolean }) => page;
const visitId = (visit: SharedVisit) => visit.postId;

export function ProfileScreen({ profileId, preview = false }: { profileId: string; preview?: boolean }) {
  const session = useSocialSession(), router = useRouter();
  const [tab, setTab] = useState<'wall' | 'visits'>('wall');
  const scroll = useRef<ScrollView>(null), offsets = useRef({ wall: 0, visits: 0 });
  const args = profileId && !session.offline ? { profileId: profileId as Id<'profiles'> } : 'skip';
  const profile = useSocialQuery(api.profiles.getPublic, args, session.key);
  const wall = useSocialQuery(api.walls.getPublic, profile.data ? args : 'skip', session.key);
  const relationship = useSocialQuery(api.friendships.getState, session.status === 'ready' && session.profileId !== profileId ? args : 'skip', session.key);
  const canReadVisits = !preview && session.status === 'ready' && (session.profileId === profileId || (relationship.data?.state === 'accepted' && !relationship.data.blocked));
  const visits = useCursorPages(api.sharedVisits.listByProfile, canReadVisits ? { profileId: profileId as Id<'profiles'> } : 'skip', session.key, visitPage, visitId);
  function changeTab(value: 'wall' | 'visits') { setTab(value); requestAnimationFrame(() => scroll.current?.scrollTo({ y: offsets.current[value], animated: false })); }
  if (session.offline) return <SocialGate session={session} />;
  if (!profileId || profile.data === null) return <SocialState title="Profile unavailable." detail="This public profile is no longer available." />;
  if (profile.error) return <SocialState title="Couldn’t load this profile." detail={socialErrorMessage(profile.error) ?? 'Please try again.'} action="Try again" onAction={profile.refresh} />;
  if (!profile.data) return <SocialState title="Opening profile…" loading />;
  const person = profile.data;
  return <GestureHandlerRootView style={socialStyles.root}>
    <ScrollView ref={scroll} contentInsetAdjustmentBehavior="automatic" stickyHeaderIndices={[1]} scrollEventThrottle={100}
      onScroll={(event) => { offsets.current[tab] = event.nativeEvent.contentOffset.y; }} contentContainerStyle={{ paddingBottom: 30 }}>
      <View>{preview && <Text style={[socialStyles.caption, { paddingHorizontal: 20 }]}>VISITOR PREVIEW</Text>}
      <PublicProfileHeader person={person} actions={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {!preview && <FriendshipControls key={`${session.key}:${profileId}`} profileId={person.profileId} session={session} />}
        <GalleryIconButton label="Share profile" icon="square.and.arrow.up" onPress={() => router.push({ pathname: '/share-profile', params: { profileId: person.profileId } })} />
      </View>}>
        {!preview && session.profileId === profileId && <GalleryButton label="Edit profile" icon="pencil" onPress={() => router.push('/edit-profile')} />}
      </PublicProfileHeader></View>
      <View style={{ backgroundColor: Gallery.paper, paddingHorizontal: 18, paddingBottom: 14, paddingTop: 6 }}>
        <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 24, borderBottomWidth: 0.5, borderBottomColor: Gallery.separator }}>{(['wall', 'visits'] as const).map((value) => <Pressable key={value} accessibilityRole="tab" accessibilityLabel={value === 'wall' ? 'Wall' : 'Visits'} accessibilityState={{ selected: tab === value }} onPress={() => changeTab(value)} style={{ paddingVertical: 13, paddingHorizontal: 2, borderBottomWidth: tab === value ? 2 : 0, borderBottomColor: Gallery.accent }}><Text style={{ fontSize: 13, color: tab === value ? Gallery.accent : Gallery.muted }}>{value === 'wall' ? 'Wall' : 'Visits'}</Text></Pressable>)}</View>
      </View>
      {tab === 'wall' ? wall.error ? <SocialState title="Couldn’t load this wall." action="Try again" onAction={wall.refresh} />
        : wall.data ? <PublicWallView wall={wall.data} arrangedBy={person.name.split(' ')[0]} onSelect={(item) => router.push({ pathname: '/artwork', params: { kind: 'wall', itemId: item.itemId, color: wall.data!.color } })} /> : <SocialState title="Opening wall…" loading />
        : !canReadVisits ? <SocialState title="Visits are shared with friends." detail="Their public wall is here for everyone. Museum visits shared with friends will appear here once you’re connected." icon="lock" />
          : <View>{visits.items.map((visit) => <Pressable key={visit.postId} accessibilityRole="button" accessibilityLabel={`Visit to ${visit.venue.name}`} onPress={() => router.push({ pathname: '/visit/[postId]', params: { postId: visit.postId } })} style={{ padding: 20, borderBottomWidth: 0.5, borderBottomColor: Gallery.separator, gap: 7 }}><Text style={{ color: Gallery.ink, fontSize: 14, fontWeight: '500' }}>{visit.venue.name}</Text><Text style={socialStyles.caption}>{formatVisitDate(visit.visitedOn)} · {visit.artworkCount ?? visit.artworks.page.length} artworks · Friends</Text></Pressable>)}
            {visits.done && !visits.items.length && !visits.error && <SocialState title="No shared visits yet." detail="When they share a museum visit, it will appear here." />}
            <PageFooter {...visits} count={visits.items.length} />
          </View>}
    </ScrollView>
  </GestureHandlerRootView>;
}
