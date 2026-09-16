import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Gallery } from '@/constants/theme';
import { useLocalOwner } from '@/lib/account/owner-store';
import { useCollectionData } from '@/lib/collection/use-collection-data';
import { CollectionVisits } from '../visits/collection-visits';
import { CollectionHeader } from './collection-header';
import { CollectionWall } from './collection-wall';
import { NativeSegmentedPicker } from './native-segmented-picker';

export function CollectionScreen() {
  return <OwnedCollection key={useLocalOwner()} />;
}

function OwnedCollection() {
  const data = useCollectionData();
  const [mode, setMode] = useState<'wall' | 'visits'>('wall');
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState('');
  const controls = <View style={{ paddingHorizontal: 18, paddingBottom: 12, backgroundColor: Gallery.paper }}>
      <NativeSegmentedPicker label="Collection view" value={mode} onChange={setMode} disabled={editing}
        options={[{ value: 'wall', label: 'Wall' }, { value: 'visits', label: 'Visits' }]} />
    </View>;
  return <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: Gallery.paper }}>
    <View style={{ flex: 1, display: mode === 'wall' ? 'flex' : 'none' }}>
      <CollectionWall works={data.works} hiddenIds={data.hiddenIds} onEditingChange={setEditing} header={<CollectionHeader />} controls={controls} />
    </View>
    <View style={{ flex: 1, display: mode === 'visits' ? 'flex' : 'none' }}>
      <CollectionVisits {...data} header={<CollectionHeader />} collectionControls={controls} search={search} onSearchChange={setSearch} clearSearch={() => setSearch('')} />
    </View>
  </SafeAreaView>;
}
