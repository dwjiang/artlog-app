import { socialStyles } from './social-styles';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { api } from '../../../convex/_generated/api';
import { Gallery } from '@/constants/theme';
import { peopleSearch } from '@/lib/social/presentation';
import type { PublicProfile } from '@/lib/social/types';
import { useCursorPages } from '@/lib/social/use-social-query';
import { useSocialSession } from '@/lib/social/use-social-session';
import { LIMITS } from '@/shared/journal/limits';
import { PageFooter, SocialState } from './social-state';
import { ProfileIdentity } from './visit-card';

const searchPage = (result: { page: PublicProfile[]; cursor: string | null; isDone: boolean }) => result;
const profileId = (profile: PublicProfile) => profile.profileId;

export function PeopleScreen() {
  const session = useSocialSession();
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const timer = setTimeout(() => setDebounced(text), 300); return () => clearTimeout(timer); }, [text]);
  const query = peopleSearch(debounced);
  const searching = text === debounced && !!query && !session.offline;
  const results = useCursorPages(api.profiles.search, searching ? { query: query! } : 'skip',
    session.key, searchPage, profileId);
  return <>
    <FlatList style={socialStyles.root} contentContainerStyle={socialStyles.content} contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" data={searching ? results.items : []}
      keyExtractor={profileId} renderItem={({ item }) => <View style={socialStyles.section}><ProfileIdentity profile={item} /></View>}
      ItemSeparatorComponent={() => <View style={{ height: 0.5, marginHorizontal: 24, backgroundColor: Gallery.separator }} />}
      ListEmptyComponent={session.offline ? <SocialState title="You’re offline." detail="Connect to find people." icon="wifi.slash" />
        : !peopleSearch(text) ? <SocialState title="Find a familiar eye." icon="person.2"
          detail={`Search by name or username. Use ${LIMITS.searchMin}–${LIMITS.searchMax} characters and up to 16 words.`} />
          : text !== debounced ? <SocialState title="Searching…" loading />
            : results.done ? <SocialState title="No people found." detail="Try another name or username." /> : null}
      ListFooterComponent={searching ? <PageFooter {...results} count={results.items.length} noun="people" /> : null}
      onEndReached={searching ? results.loadMore : undefined} onEndReachedThreshold={0.4} />
    <Stack.SearchBar placeholder="Name or username" autoCapitalize="none" hideWhenScrolling={false} placement="stacked" allowToolbarIntegration={false}
      onChangeText={(event) => setText(event.nativeEvent.text)} onCancelButtonPress={() => setText('')} />
  </>;
}
