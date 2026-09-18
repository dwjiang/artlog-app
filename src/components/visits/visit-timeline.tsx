import { api } from '../../../convex/_generated/api';
import { useSocialQuery } from '@/lib/social/use-social-query';
import { useSocialSession } from '@/lib/social/use-social-session';
import type { ReactElement } from 'react';
import { Link } from 'expo-router';
import { FlatList, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ThemedText as Text } from '@/components/themed-text';
import { Fonts, Gallery } from '@/constants/theme';
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
            <VisitSymbol name="chevron.right" size={13} color={Gallery.muted} />
          </View>
          <Text style={styles.meta}>{place} · {artworks}{shared ? ' · Shared ✓' : ''}</Text>
          {!!visit.works.length && <View style={{ paddingTop: 9 }}><ArtworkPreviews works={visit.works} limit={3} overflow /></View>}
        </View>
      </View>
    </Pressable>
  </Link>;
}
export function VisitTimeline({ visits, header, controls, summary, empty, groupByMuseum = false }: {
  visits: VisitSummary[]; header?: ReactElement; controls?: ReactElement; summary?: ReactElement; empty?: ReactElement; groupByMuseum?: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  const session = useSocialSession();
  const sharing = useSocialQuery(api.sharedVisits.listShared, session.status === 'ready' ? {} : 'skip', session.key);
  const shared = new Set(sharing.data);
  const sections = groupByMuseum ? [...new Set(visits.map((visit) => visit.venueId))].map((id) => {
    const data = visits.filter((visit) => visit.venueId === id);
    return { key: id, title: data[0].venueName, data };
  }) : groupHistoryByMonth(visits);
  type Row = { key: string; kind: 'element'; element: ReactElement } | { key: string; kind: 'month'; title: string } | { key: string; kind: 'visit'; visit: VisitSummary };
  const rows: Row[] = [];
  if (controls) rows.push({ key: 'controls', kind: 'element', element: controls });
  if (summary) rows.push({ key: 'summary', kind: 'element', element: summary });
  for (const section of sections) {
    rows.push({ key: `month:${section.key}`, kind: 'month', title: section.title });
    for (const visit of section.data) rows.push({ key: visit.localId, kind: 'visit', visit });
  }
  return <FlatList data={rows} keyExtractor={(row) => row.key} contentInsetAdjustmentBehavior="automatic"
    keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets ListHeaderComponent={header}
    stickyHeaderIndices={controls && fontScale < 1.5 ? [header ? 1 : 0] : undefined}
    contentContainerStyle={{ paddingBottom: 30 }} ListFooterComponent={<>{empty}<VisitPrivacyNote /></>}
    renderItem={({ item }) => item.kind === 'element' ? item.element : item.kind === 'month'
      ? <Text accessibilityRole="header" style={[visitStyles.eyebrow, styles.section]}>{item.title}</Text>
      : <VisitRow visit={item.visit} shared={shared.has(item.visit.localId)} />} />;
}
const styles = StyleSheet.create({
  visit: { paddingVertical: 16, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: Gallery.separator },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  date: { width: 37, paddingTop: 2 },
  day: { fontFamily: Fonts.display, fontSize: 24, letterSpacing: -1, color: Gallery.ink },
  month: { fontSize: 13, letterSpacing: 0.6, textTransform: 'uppercase', color: Gallery.muted, marginTop: 3 },
  content: { flex: 1, alignSelf: 'stretch' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { flex: 1, fontSize: 17, lineHeight: 25, fontWeight: '600', color: Gallery.ink },
  meta: { fontSize: 13, lineHeight: 18, color: Gallery.muted, marginTop: 2 },
  section: { color: Gallery.muted, paddingTop: 15, paddingBottom: 8, paddingHorizontal: 20 },
});
