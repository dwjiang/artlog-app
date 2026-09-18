import { Stack } from 'expo-router';
import { useState } from 'react';
import { useCollectionData } from '@/lib/collection/use-collection-data';
import { CollectionArtworks } from './collection-artworks';

export function AllArtworksScreen() {
  const data = useCollectionData();
  const [search, setSearch] = useState('');
  return <>
    <CollectionArtworks {...data} search={search} />
    <Stack.SearchBar placeholder="Title, artist, date or place" hideWhenScrolling={false} autoCapitalize="none"
      onChangeText={(event) => setSearch(event.nativeEvent.text)} onCancelButtonPress={() => setSearch('')} />
  </>;
}
