import { useNetworkState } from 'expo-network';
import { ThemedText as Text } from '@/components/themed-text';
import { useListeningDockInset } from '@/components/audio/use-listening-dock-inset';
import { useCallback, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Gallery } from '@/constants/theme';
import { useLocalOwner } from '@/lib/account/owner-store';
import { useCollectionData } from '@/lib/collection/use-collection-data';
import { CollectionVisits } from '../visits/collection-visits';
import { CollectionHeader } from './collection-header';
import { CollectionArtworks } from './collection-artworks';
import { CollectionSearchField } from './collection-search-field';
import { CollectionWall } from './collection-wall';
import { NativeSegmentedPicker } from './native-segmented-picker';

export function CollectionScreen() {
  return <CollectionSession key={useLocalOwner()} />;
}

function CollectionSession() {
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<'collection' | 'visits'>('collection');
  const { view } = useLocalSearchParams<{ view?: string }>();
  useFocusEffect(useCallback(() => {
    if (view !== 'wall' && view !== 'visits') return;
    setMode(view === 'wall' ? 'collection' : 'visits');
    router.setParams({ view: undefined });
  }, [view]));
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState('');
  const [artworkSearch, setArtworkSearch] = useState('');
  return <OwnedCollection key={attempt} mode={mode} setMode={setMode} editing={editing} setEditing={setEditing}
    search={search} setSearch={setSearch} artworkSearch={artworkSearch} setArtworkSearch={setArtworkSearch}
    onRetry={() => setAttempt((value) => value + 1)} />;
}

function OwnedCollection({ mode, setMode, editing, setEditing, search, setSearch, artworkSearch, setArtworkSearch, onRetry }: {
  mode: 'collection' | 'visits'; setMode: (mode: 'collection' | 'visits') => void;
  editing: boolean; setEditing: (editing: boolean) => void;
  search: string; setSearch: (search: string) => void;
  artworkSearch: string; setArtworkSearch: (search: string) => void; onRetry: () => void;
}) {
  const data = useCollectionData();
  const network = useNetworkState();
  // The tab layout floats the visit bar only while the phone is at the visit's museum; pad for it on the same terms.
  const dockInset = useListeningDockInset();
  const guest = !data.owner.startsWith('account:');
  const controls = <View style={{ paddingHorizontal: 20, paddingBottom: 12, backgroundColor: Gallery.paper }}>
      <NativeSegmentedPicker label="Collection view" value={mode} onChange={setMode} disabled={editing}
        options={[{ value: 'collection', label: guest ? 'Artworks' : 'Wall' }, { value: 'visits', label: 'Visits' }]} />
    </View>;
  const header = <><CollectionHeader loading={data.loading && !data.works.length && !data.visits.length && !data.error} artworkCount={data.works.length} visitCount={data.visits.length} />{network.isInternetReachable === false && <View style={{ marginHorizontal: 20, marginBottom: 12, padding: 12, borderRadius: 8, backgroundColor: Gallery.fill }}><Text style={{ color: Gallery.muted, fontSize: 13 }}>Offline · Your saved collection is available on this iPhone.</Text></View>}</>;
  return <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: Gallery.paper, paddingBottom: editing ? 0 : dockInset }}>
    <View style={{ flex: 1, display: mode === 'collection' ? 'flex' : 'none' }}>
      {guest ? <CollectionArtworks {...data} search={artworkSearch} onClearSearch={() => setArtworkSearch('')} onRetry={onRetry} header={header}
        controls={<View style={{ backgroundColor: Gallery.paper }}>{controls}{data.works.length > 0 && <View style={{ paddingHorizontal: 20, paddingBottom: 10 }}>
          <CollectionSearchField filled showLabel={false} value={artworkSearch} label="Search your artworks" placeholder="Title, artist, date or place" onChange={setArtworkSearch} onClear={() => setArtworkSearch('')} />
        </View>}</View>} />
        : <CollectionWall works={data.works} hiddenIds={data.hiddenIds} onEditingChange={setEditing} header={header} controls={controls} />}
    </View>
    <View style={{ flex: 1, display: mode === 'visits' ? 'flex' : 'none' }}>
      <CollectionVisits {...data} header={header} collectionControls={controls} search={search} onSearchChange={setSearch} clearSearch={() => setSearch('')} />
    </View>
  </SafeAreaView>;
}
