import type { ReactElement } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Gallery } from '@/constants/theme';
import { searchVisitSummaries, visitCounts, type VisitSummary } from '@/lib/journal/visit-summaries';
import { searchTerm } from '@/lib/journal/query';
import { useVisitView } from '@/lib/journal/use-visit-view';
import { GalleryButton } from '../collection/gallery-button';
import { NativeSegmentedPicker } from '../collection/native-segmented-picker';
import { VisitGlobe } from './visit-globe';
import { VisitTimeline } from './visit-timeline';
import { VisitMessage, VisitPrivacyNote, VisitSymbol, visitStyles as styles } from './visit-ui';

export function CollectionVisits({ owner, visits, search, header, loading, error, clearSearch, onSearchChange }: {
  owner: string; visits: VisitSummary[]; search: string; header?: ReactElement;
  loading: boolean; error?: Error; clearSearch: () => void; onSearchChange: (value: string) => void;
}) {
  const { mode, changeMode, error: preferenceError } = useVisitView(owner);
  const { fontScale } = useWindowDimensions();
  const counts = visitCounts(visits);
  const shown = searchVisitSummaries(visits, search);
  const controls = <View style={{ paddingHorizontal: 18, paddingTop: 4, gap: 12 }}>{header}
    <View style={{ flexDirection: fontScale > 1.5 ? 'column' : 'row', alignItems: fontScale > 1.5 ? 'stretch' : 'center', justifyContent: 'space-between', gap: 8 }}>
      <NativeSegmentedPicker compact label="Visit view" value={mode} disabled={!mode} onChange={changeMode} options={[{ value: 'list', label: 'List', icon: 'list.bullet' }, { value: 'globe', label: 'Globe', icon: 'globe' }]} />
      <GalleryButton label="Add visit" icon="plus" onPress={() => router.push('/visit-create')} />
    </View>
    {mode === 'list' && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, borderRadius: 10, backgroundColor: Gallery.fill }}>
      <VisitSymbol name="magnifyingglass" size={16} />
      <TextInput value={search} onChangeText={onSearchChange} placeholder="Search your visits" accessibilityLabel="Search your visits" autoCapitalize="none"
        autoCorrect={false} returnKeyType="search" clearButtonMode="never" style={{ flex: 1, minHeight: 38, paddingVertical: 8, fontSize: 14, color: Gallery.ink }} />
      {!!search && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={clearSearch} hitSlop={10} style={{ paddingVertical: 10 }}>
        <VisitSymbol name="xmark.circle.fill" size={16} />
      </Pressable>}
    </View>}
    {preferenceError && <Text style={styles.error}>{preferenceError}</Text>}
  </View>;
  let message: ReactElement | undefined;
  if (error) message = <VisitMessage action="Go to Scan" onAction={() => router.push('/')}>Your visits could not load. Reopen Collection to try again.</VisitMessage>;
  else if (loading || !mode) message = <VisitMessage loading>Loading your visits…</VisitMessage>;
  else if (!visits.length) message = <VisitMessage action="Add visit" onAction={() => router.push('/visit-create')}>Remember your first museum visit. You can add a visit without saving any artworks.</VisitMessage>;
  else if (mode === 'list' && !shown.length) message = <VisitMessage action="Clear search" onAction={clearSearch}>{searchTerm(search) === null
    ? 'Enter between 2 and 100 characters to search.' : `No visits match “${search.trim()}”.`}</VisitMessage>;
  if (mode !== 'list') return <View style={{ flex: 1 }}>{controls}<ScrollView contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
    contentContainerStyle={{ paddingBottom: 30 }}>{message ?? <VisitGlobe visits={visits} onList={() => changeMode('list')} />}<VisitPrivacyNote /></ScrollView></View>;
  // One list container for every search state keeps the search field mounted while typing.
  return <View style={{ flex: 1 }}>{controls}<VisitTimeline visits={message ? [] : shown}
    header={<Text style={[styles.eyebrow, { padding: 18 }]}>{counts.museums} {counts.museums === 1 ? 'museum' : 'museums'} · {counts.visits} {counts.visits === 1 ? 'visit' : 'visits'}</Text>} empty={message} /></View>;
}
