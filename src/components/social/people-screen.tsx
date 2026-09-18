import { socialStyles } from './social-styles';
import { Stack, useLocalSearchParams } from 'expo-router';
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

const searchPage = (result: { page: PublicProfile[]; cursor: string | null; isDone: boolean }) => result;
const profileId = (profile: PublicProfile) => profile.profileId;

export function PeopleScreen() {
  const session = useSocialSession();
  const params = useLocalSearchParams<{ filter?: string }>();
  const [filter, setFilter] = useState<'all' | 'friends'>(params.filter === 'friends' ? 'friends' : 'all');
  const friends = useSocialQuery(api.profiles.friends, session.status === 'ready' ? {} : 'skip', session.key);
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const timer = setTimeout(() => setDebounced(text), 300); return () => clearTimeout(timer); }, [text]);
  const query = peopleSearch(debounced);
  const searching = text === debounced && !!query && !session.offline;
  const results = useCursorPages(api.profiles.search, searching ? { query: query! } : 'skip',
    session.key, searchPage, profileId);
  const discovery = useCursorPages(api.profiles.discover, !text.trim() && !session.offline ? {} : 'skip', session.key, searchPage, profileId);
  return <>
    <FlatList style={socialStyles.root} contentContainerStyle={socialStyles.content} contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" data={filter === 'friends' ? (friends.data ?? []).filter((person) => !text.trim() || `${person.name} ${person.username}`.toLowerCase().includes(text.trim().toLowerCase())) : searching ? results.items : !text.trim() ? discovery.items : []}
      keyExtractor={profileId} renderItem={({ item }) => <View style={[socialStyles.section, { gap: 8 }]}><ProfileIdentity profile={item} />
        {friends.data?.some((friend) => friend.profileId === item.profileId) && <Text style={{ fontSize: 13, color: Gallery.accent, marginLeft: 56 }}>✓ Friends</Text>}</View>}
      ListHeaderComponent={<View style={{ padding: 18, gap: 16 }}>{!text.trim() && filter === 'all' && <Text style={{ color: Gallery.muted, fontSize: 13 }}>Discover people and their little museums.</Text>}<NativeSegmentedPicker label="People filter" value={filter} onChange={setFilter}
        options={[{ value: 'all', label: 'All people' }, { value: 'friends', label: 'Friends' }]} /></View>}
      ItemSeparatorComponent={() => <View style={{ height: 0.5, marginHorizontal: 24, backgroundColor: Gallery.separator }} />}
      ListEmptyComponent={filter === 'friends' ? session.status !== 'ready' ? <SocialGate session={session} /> : <SocialState title={friends.error ? 'Couldn’t load your friends.' : friends.loading ? 'Opening friends…' : 'No friends found.'}
        loading={friends.loading} detail={friends.loading ? undefined : 'Search All people to make a connection.'} action={friends.error ? 'Try again' : undefined} onAction={friends.refresh} /> : session.offline ? <SocialState title="You’re offline." detail="Connect to find people." icon="wifi.slash" />
        : !peopleSearch(text) ? <SocialState title="Find a familiar eye." icon="person.2"
          detail={`Search by name or username. Use ${LIMITS.searchMin}–${LIMITS.searchMax} characters and up to 16 words.`} />
          : text !== debounced ? <SocialState title="Searching…" loading />
            : results.done ? <SocialState title="No people found." detail="Try another name or username." /> : null}
      ListFooterComponent={filter === 'all' ? searching ? <PageFooter {...results} count={results.items.length} noun="people" /> : !text.trim() ? <PageFooter {...discovery} count={discovery.items.length} noun="people" /> : null : null}
      onEndReached={filter === 'all' ? searching ? results.loadMore : !text.trim() ? discovery.loadMore : undefined : undefined} onEndReachedThreshold={0.4} />
    <Stack.SearchBar placeholder="Name or username" autoCapitalize="none" hideWhenScrolling={false} placement="stacked" allowToolbarIntegration={false}
      onChangeText={(event) => setText(event.nativeEvent.text)} onCancelButtonPress={() => setText('')} />
  </>;
}
