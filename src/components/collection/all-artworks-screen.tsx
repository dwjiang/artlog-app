import { Stack } from 'expo-router';
import { useRef, useState } from 'react';
import type { SearchBarCommands } from 'react-native-screens';
import { useCollectionData } from '@/lib/collection/use-collection-data';
import { CollectionArtworks } from './collection-artworks';

export function AllArtworksScreen() {
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState('');
  // The native search bar keeps its own text; clearing only the state would leave the stale query in the header.
  const searchBar = useRef<SearchBarCommands>(null);
  return <>
    <AllArtworks key={attempt} search={search} onClearSearch={() => { searchBar.current?.clearText(); setSearch(''); }} onRetry={() => setAttempt((value) => value + 1)} />
    <Stack.SearchBar ref={searchBar} placeholder="Title, artist, date or place" hideWhenScrolling={false} autoCapitalize="none"
      onChangeText={(event) => setSearch(event.nativeEvent.text)} onCancelButtonPress={() => setSearch('')} />
  </>;
}

function AllArtworks({ search, onClearSearch, onRetry }: { search: string; onClearSearch: () => void; onRetry: () => void }) {
  const data = useCollectionData();
  return <CollectionArtworks {...data} search={search} onClearSearch={onClearSearch} onRetry={onRetry} />;
}
