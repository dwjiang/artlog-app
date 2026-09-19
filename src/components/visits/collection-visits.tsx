import type { ReactElement } from 'react';
import { router } from 'expo-router';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { ThemedText as Text } from '@/components/themed-text';
import { Gallery } from '@/constants/theme';
import { searchVisitSummaries, visitCounts, type VisitSummary } from '@/lib/journal/visit-summaries';
import { searchTerm } from '@/lib/journal/query';
import { useVisitView } from '@/lib/journal/use-visit-view';
import { CollectionSearchField } from '../collection/collection-search-field';
import { GalleryButton } from '../collection/gallery-button';
import { NativeSegmentedPicker } from '../collection/native-segmented-picker';
import { VisitGlobe } from './visit-globe';
import { VisitTimeline } from './visit-timeline';
import { VisitMessage, VisitPrivacyNote, visitStyles as styles } from './visit-ui';
import { ListSkeleton } from '@/components/loading-skeleton';

export function CollectionVisits({ owner, visits, search, header, collectionControls, loading, error, clearSearch, onSearchChange }: {
  owner: string; visits: VisitSummary[]; search: string; header?: ReactElement; collectionControls?: ReactElement;
  loading: boolean; error?: Error; clearSearch: () => void; onSearchChange: (value: string) => void;
}) {
  const { mode, changeMode, error: preferenceError } = useVisitView(owner);
  const { fontScale } = useWindowDimensions();
  const counts = visitCounts(visits);
  const shown = searchVisitSummaries(visits, search);
  const controls = <View style={{ backgroundColor: Gallery.paper }}>{collectionControls}<View style={{ paddingHorizontal: 20, paddingTop: 4, gap: 12, paddingBottom: 10 }}>
    <View style={{ flexDirection: fontScale > 1.5 ? 'column' : 'row', alignItems: fontScale > 1.5 ? 'stretch' : 'center', justifyContent: 'space-between', gap: 8 }}>
      <NativeSegmentedPicker compact label="Visit view" value={mode} disabled={!mode} onChange={changeMode} options={[{ value: 'list', label: 'List', icon: 'list.bullet' }, { value: 'globe', label: 'Globe', icon: 'globe' }]} />
      <GalleryButton label="Add visit" icon="plus" onPress={() => router.push('/visit-create')} />
    </View>
    {mode === 'list' && <CollectionSearchField value={search} label="Search your visits" onChange={onSearchChange} onClear={clearSearch} />}
    {preferenceError && <Text style={styles.error}>{preferenceError}</Text>}
  </View></View>;
  let message: ReactElement | undefined;
  if (error) message = <VisitMessage action="Go to Scan" onAction={() => router.push('/scan')}>Your visits could not load. Reopen Collection to try again.</VisitMessage>;
  // `loading` also covers the venue metadata read, so visits never render without their places.
  else if (!mode || loading) message = mode === 'list'
    ? <ListSkeleton label="Loading your visits…" rows={3} />
    : <VisitMessage loading>Loading your visits…</VisitMessage>;
  else if (!visits.length) message = <VisitMessage action="Add visit" onAction={() => router.push('/visit-create')}>Remember your first museum visit. You can add a visit without saving any artworks.</VisitMessage>;
  else if (mode === 'list' && !shown.length) message = <VisitMessage action="Clear search" onAction={clearSearch}>{searchTerm(search) === null
    ? 'Enter between 2 and 100 characters to search.' : `No visits match “${search.trim()}”.`}</VisitMessage>;
  if (mode !== 'list') return <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag" stickyHeaderIndices={fontScale < 1.5 ? [header ? 1 : 0] : undefined}
    contentContainerStyle={{ paddingBottom: 30 }}>{header}{controls}{message ?? <VisitGlobe visits={visits} onList={() => changeMode('list')} />}<VisitPrivacyNote /></ScrollView>;
  // One list container for every search state keeps the search field mounted while typing.
  return <VisitTimeline visits={message ? [] : shown} header={header} controls={controls}
    summary={loading ? undefined : <Text style={[styles.eyebrow, { padding: 18 }]}>{counts.museums} {counts.museums === 1 ? 'museum' : 'museums'} · {counts.visits} {counts.visits === 1 ? 'visit' : 'visits'}</Text>} empty={message} />;
}
