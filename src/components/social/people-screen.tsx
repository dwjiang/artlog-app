import { SocialInvitation } from './social-invitation';
import { GalleryButton } from '../collection/gallery-button';
import { SearchEmptyState } from '../empty-state';
import { socialStyles } from './social-styles';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { api } from '../../../convex/_generated/api';
import { Gallery } from '@/constants/theme';
import { peopleSearch } from '@/lib/social/presentation';
import type { PublicProfile } from '@/lib/social/types';
import { useCursorPages, useSocialQuery } from '@/lib/social/use-social-query';
import { useSocialSession } from '@/lib/social/use-social-session';
import { LIMITS } from '@/shared/journal/limits';
import { PageFooter, SocialGate, SocialState } from './social-state';
import { NativeSegmentedPicker } from '../collection/native-segmented-picker';
import { ThemedText as Text } from '@/components/themed-text';
import { ProfileIdentity } from './visit-card';
import { CollectionSearchField } from '../collection/collection-search-field';
import { ListSkeleton } from '@/components/loading-skeleton';
import { FriendsInvitation } from './friends-invitation';

const searchPage = (result: { page: PublicProfile[]; cursor: string | null; isDone: boolean }) => result;
const profileId = (profile: PublicProfile) => profile.profileId;

export function PeopleScreen() {
  const session = useSocialSession();
  const params = useLocalSearchParams<{ filter?: string }>();
  const [filter, setFilter] = useState<'all' | 'friends'>(params.filter === 'friends' ? 'friends' : 'all');
  const guestFriends = filter === 'friends' && session.status === 'signed-out';
  const friends = useSocialQuery(api.profiles.friends, session.status === 'ready' ? {} : 'skip', session.key);
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const timer = setTimeout(() => setDebounced(text), 300); return () => clearTimeout(timer); }, [text]);
  const query = peopleSearch(debounced);
  const searching = text === debounced && !!query && !session.offline;
  const results = useCursorPages(api.profiles.search, searching ? { query: query! } : 'skip',
    session.key, searchPage, profileId);
  const discovery = useCursorPages(api.profiles.discover, !text.trim() && !session.offline ? {} : 'skip', session.key, searchPage, profileId);
  const emptyFriends = filter === 'friends' && session.status === 'ready' && !friends.loading && !friends.error && friends.data?.length === 0 && !text.trim();
  const explore = () => { setText(''); setFilter('all'); };
  return <>
    <Stack.Screen options={{ title: '' }} />
    <FlatList style={socialStyles.root} contentContainerStyle={socialStyles.content} contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" data={guestFriends ? [] : filter === 'friends' ? (friends.data ?? []).filter((person) => !text.trim() || `${person.name} ${person.username}`.toLowerCase().includes(text.trim().toLowerCase())) : searching ? results.items : !text.trim() ? discovery.items : []}
      keyExtractor={profileId} renderItem={({ item }) => <View style={{ paddingHorizontal: 20, paddingVertical: 12 }}><ProfileIdentity profile={item} showChevron friend={friends.data?.some((friend) => friend.profileId === item.profileId)} /></View>}
      ListHeaderComponent={<View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12, gap: 12 }}>
        <Text variant="pageTitle" accessibilityRole="header">People</Text>
        {!text.trim() && filter === 'all' && <Text style={{ color: Gallery.muted, fontSize: 15 }}>Discover people and their little museums.</Text>}
        {!guestFriends && !emptyFriends && <CollectionSearchField label="Name or username" value={text} onChange={setText} onClear={() => setText('')} showLabel={false} />}
        <NativeSegmentedPicker label="People filter" value={filter} onChange={setFilter}
        options={[{ value: 'all', label: 'All people' }, { value: 'friends', label: 'Friends' }]} /></View>}
      ItemSeparatorComponent={() => <View style={{ height: 0.5, marginHorizontal: 24, backgroundColor: Gallery.separator }} />}
      ListEmptyComponent={guestFriends ? <FriendsInvitation onExplore={explore} />
        : filter === 'friends' ? session.status !== 'ready' ? <SocialGate session={session} />
          : friends.loading && !friends.error ? <ListSkeleton label="Opening friends…" avatar />
            : friends.error ? <SocialState title="Couldn’t load your friends." action="Try again" onAction={friends.refresh} />
              : emptyFriends ? <SocialInvitation title={'Find your\nart people.'} detail="Search by name or username to add your first friend.">
                <GalleryButton label="Find people" variant="filled" fullWidth onPress={explore} />
              </SocialInvitation> : text.trim() ? <SearchEmptyState title="No friends found." detail="Try another name or username." onClear={() => setText('')} /> : null
        : session.offline ? <SocialState title="You’re offline." detail="Connect to find people." icon="wifi.slash" />
          : !text.trim() ? discovery.done && !discovery.loading && !discovery.error ? <SocialInvitation title={'A community\nin the making.'} detail="Public profiles will appear here. In the meantime, keep discovering art.">
            <GalleryButton label="Scan artwork" variant="filled" fullWidth onPress={() => { router.dismissAll(); router.navigate('/scan'); }} />
          </SocialInvitation> : null
            : !peopleSearch(text) ? <SocialState title="Find a familiar eye." icon="person.2" detail={`Search by name or username. Use ${LIMITS.searchMin}–${LIMITS.searchMax} characters and up to 16 words.`} />
              : text !== debounced ? <ListSkeleton label="Searching…" avatar />
                : results.done && !results.loading && !results.error ? <SearchEmptyState title="No people found." detail="Try another name or username." onClear={() => setText('')} /> : null}
      ListFooterComponent={filter === 'all' ? searching ? <PageFooter {...results} count={results.items.length} noun="people" /> : !text.trim() ? discovery.done && !discovery.error ? discovery.items.length > 0 ? <Text style={{ padding: 20, color: Gallery.muted, fontSize: 13 }}>Search by name or username.</Text> : null : <PageFooter {...discovery} count={discovery.items.length} noun="people" /> : null : null}
      onEndReached={filter === 'all' ? searching ? results.loadMore : !text.trim() ? discovery.loadMore : undefined : undefined} onEndReachedThreshold={0.4} />
  </>;
}
