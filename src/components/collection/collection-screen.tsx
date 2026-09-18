import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Gallery } from '@/constants/theme';
import { useLocalOwner } from '@/lib/account/owner-store';
import { useCollectionData } from '@/lib/collection/use-collection-data';
import { SyncPrompt } from '@/components/account/sync-prompt';
import { CollectionVisits } from '../visits/collection-visits';
import { CollectionHeader } from './collection-header';
import { CollectionArtworks } from './collection-artworks';
import { CollectionSearchField } from './collection-search-field';
import { CollectionWall } from './collection-wall';
import { NativeSegmentedPicker } from './native-segmented-picker';

export function CollectionScreen() {
  return <OwnedCollection key={useLocalOwner()} />;
}

function OwnedCollection() {
  const data = useCollectionData();
  const guest = !data.owner.startsWith('account:');
  const [mode, setMode] = useState<'collection' | 'visits'>('collection');
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState('');
  const [artworkSearch, setArtworkSearch] = useState('');
  const controls = <View style={{ paddingHorizontal: 18, paddingBottom: 12, backgroundColor: Gallery.paper }}>
      <NativeSegmentedPicker label="Collection view" value={mode} onChange={setMode} disabled={editing}
        options={[{ value: 'collection', label: guest ? 'Artworks' : 'Wall' }, { value: 'visits', label: 'Visits' }]} />
    </View>;
  return <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: Gallery.paper }}>
    <View style={{ flex: 1, display: mode === 'collection' ? 'flex' : 'none' }}>
      {guest ? <CollectionArtworks {...data} search={artworkSearch} header={<CollectionHeader />} summary={data.works.length > 0 ? <SyncPrompt /> : undefined}
        controls={<View style={{ backgroundColor: Gallery.paper }}>{controls}<View style={{ paddingHorizontal: 18, paddingBottom: 10 }}>
          <CollectionSearchField value={artworkSearch} label="Search your artworks" placeholder="Title, artist, date or place" onChange={setArtworkSearch} onClear={() => setArtworkSearch('')} />
        </View></View>} />
        : <CollectionWall works={data.works} hiddenIds={data.hiddenIds} onEditingChange={setEditing} header={<CollectionHeader />} controls={controls} />}
    </View>
    <View style={{ flex: 1, display: mode === 'visits' ? 'flex' : 'none' }}>
      <CollectionVisits {...data} header={<CollectionHeader />} collectionControls={controls} search={search} onSearchChange={setSearch} clearSearch={() => setSearch('')} />
    </View>
  </SafeAreaView>;
}
