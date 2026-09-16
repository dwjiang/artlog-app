import { api } from '../../../convex/_generated/api';
import { useSocialQuery } from '@/lib/social/use-social-query';
import { useSocialSession } from '@/lib/social/use-social-session';
import type { ReactElement } from 'react';
import { Link } from 'expo-router';
import { Pressable, SectionList, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gallery } from '@/constants/theme';
import type { VisitSummary } from '@/lib/journal/visit-summaries';
import { countryName, formatVisitDate, groupHistoryByMonth } from '@/lib/journal/history';
import { ArtworkPreviews, VisitPrivacyNote, VisitSymbol, visitStyles } from './visit-ui';

export function VisitRow({ visit, shared = false }: { visit: VisitSummary; shared?: boolean }) {
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.5;
  const place = visit.city || visit.regionName || countryName(visit.country) || 'Location unavailable';
  const artworks = `${visit.works.length} ${visit.works.length === 1 ? 'artwork' : 'artworks'}`;
  return <Link href={{ pathname: '/journal/[visitId]', params: { visitId: visit.localId } }} asChild>
    <Pressable accessibilityRole="button" accessibilityLabel={`${visit.venueName}, ${formatVisitDate(visit.visitedOn)}, ${artworks}`}
      style={styles.visit}>
      <View style={[styles.row, largeText && { flexDirection: 'column' }]}>
        {largeText ? <Text style={styles.meta}>{formatVisitDate(visit.visitedOn)}</Text> : <View style={styles.date}>
          <Text style={styles.day}>{Number(visit.visitedOn.slice(8))}</Text>
          <Text style={styles.month}>{formatVisitDate(visit.visitedOn).split(' ')[1]}</Text>
        </View>}
        <View style={styles.content}>
          <View style={styles.titleRow}>
            <Text style={styles.name}>{visit.venueName}</Text>
            <VisitSymbol name="chevron.right" size={13} color="#888B7E" />
          </View>
          <Text style={styles.meta}>{place} · {artworks}{shared ? ' · Shared ✓' : ''}</Text>
          {!!visit.works.length && <View style={{ paddingTop: 9 }}><ArtworkPreviews works={visit.works} /></View>}
        </View>
      </View>
    </Pressable>
  </Link>;
}
export function VisitTimeline({ visits, header, empty, groupByMuseum = false }: {
  visits: VisitSummary[]; header?: ReactElement; empty?: ReactElement; groupByMuseum?: boolean;
}) {
  const session = useSocialSession();
  const sharing = useSocialQuery(api.sharedVisits.listShared, session.status === 'ready' ? {} : 'skip', session.key);
  const shared = new Set(sharing.data);
  const sections = groupByMuseum ? [...new Set(visits.map((visit) => visit.venueId))].map((id) => {
    const data = visits.filter((visit) => visit.venueId === id);
    return { key: id, title: data[0].venueName, data };
  }) : groupHistoryByMonth(visits);
  return <SectionList sections={sections} keyExtractor={(visit) => visit.localId} contentInsetAdjustmentBehavior="automatic"
    keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" ListHeaderComponent={header} ListEmptyComponent={empty}
    contentContainerStyle={{ paddingBottom: 30 }} ListFooterComponent={<VisitPrivacyNote />}
    stickySectionHeadersEnabled={false}
    renderSectionHeader={({ section }) => <Text accessibilityRole="header" style={[visitStyles.eyebrow, styles.section]}>{section.title}</Text>}
    renderItem={({ item }) => <VisitRow visit={item} shared={shared.has(item.localId)} />} />;
}
const styles = StyleSheet.create({
  visit: { paddingVertical: 13, paddingHorizontal: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(38,35,32,0.09)' },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  date: { width: 37, paddingTop: 2 },
  day: { fontSize: 24, fontWeight: '400', letterSpacing: -1, color: Gallery.ink },
  month: { fontSize: 9, letterSpacing: 0.6, textTransform: 'uppercase', color: '#7A7B70', marginTop: 3 },
  content: { flex: 1, alignSelf: 'stretch' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { flex: 1, fontSize: 15, lineHeight: 20, fontWeight: '600', color: Gallery.ink },
  meta: { fontSize: 11, lineHeight: 17, color: Gallery.muted, marginTop: 2 },
  section: { color: '#838477', paddingTop: 15, paddingBottom: 8, paddingHorizontal: 18 },
});
