import { api } from '../../../convex/_generated/api';
import { useSocialQuery } from '@/lib/social/use-social-query';
import { useSocialSession } from '@/lib/social/use-social-session';
import type { ReactElement } from 'react';
import { Link } from 'expo-router';
import { FlatList, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ThemedText as Text } from '@/components/themed-text';
import { Gallery } from '@/constants/theme';
import { useLocalOwner } from '@/lib/account/owner-store';
import type { VisitSummary } from '@/lib/journal/visit-summaries';
import { countryName, formatVisitDate, groupHistoryByMonth } from '@/lib/journal/history';
import { isVisitNew, useSeenVisits } from '@/lib/journal/visit-seen';
import { useVenue } from '@/lib/venue/use-venue';
import { VisitPrivacyNote, VisitSymbol, visitStyles } from './visit-ui';

export function VisitRow({ visit, shared = false, isNew = false, isOpen = false }: { visit: VisitSummary; shared?: boolean; isNew?: boolean; isOpen?: boolean }) {
  const place = visit.city || visit.regionName || countryName(visit.country) || 'Location unavailable';
  const artworks = `${visit.works.length} ${visit.works.length === 1 ? 'artwork' : 'artworks'}`;
  const meta = `${formatVisitDate(visit.visitedOn)} · ${place} · ${artworks}${shared ? ' · Shared ✓' : ''}`;
  return <Link href={{ pathname: '/journal/[visitId]', params: { visitId: visit.localId } }} asChild>
    <Pressable accessibilityRole="button" accessibilityLabel={`${visit.venueName}, ${formatVisitDate(visit.visitedOn)}, ${artworks}${isOpen ? ', visiting now' : isNew ? ', new' : ''}`}
      style={styles.visit}>
      <View style={styles.row}>
        <View style={styles.content}>
          <View style={styles.titleRow}>
            <Text style={styles.name}>{visit.venueName}</Text>
            <View style={styles.spacer} />
            <VisitSymbol name="chevron.right" size={13} color={Gallery.muted} />
          </View>
          <Text style={styles.meta}>{meta}</Text>
        </View>
      </View>
    </Pressable>
  </Link>;
}
export function VisitTimeline({ visits, header, controls, empty, groupByMuseum = false }: {
  visits: VisitSummary[]; header?: ReactElement; controls?: ReactElement; empty?: ReactElement; groupByMuseum?: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  const session = useSocialSession();
  const sharing = useSocialQuery(api.sharedVisits.listShared, session.status === 'ready' ? {} : 'skip', session.key);
  const shared = new Set(sharing.data);
  const seen = useSeenVisits(useLocalOwner());
  const open = useVenue().visit?.localId;
  const sections = groupByMuseum ? [...new Set(visits.map((visit) => visit.venueId))].map((id) => {
    const data = visits.filter((visit) => visit.venueId === id);
    return { key: id, title: data[0].venueName, data };
  }) : groupHistoryByMonth(visits);
  type Row = { key: string; kind: 'element'; element: ReactElement } | { key: string; kind: 'month'; title: string } | { key: string; kind: 'visit'; visit: VisitSummary };
  const rows: Row[] = [];
  if (controls) rows.push({ key: 'controls', kind: 'element', element: controls });
  for (const section of sections) {
    rows.push({ key: `month:${section.key}`, kind: 'month', title: section.title });
    for (const visit of section.data) rows.push({ key: visit.localId, kind: 'visit', visit });
  }
  return <FlatList data={rows} keyExtractor={(row) => row.key} contentInsetAdjustmentBehavior="automatic"
    keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets ListHeaderComponent={header}
    stickyHeaderIndices={controls && fontScale < 1.5 ? [header ? 1 : 0] : undefined}
    contentContainerStyle={{ paddingBottom: open ? 110 : 30 }} ListFooterComponent={<>{empty}<VisitPrivacyNote /></>}
    renderItem={({ item }) => item.kind === 'element' ? item.element : item.kind === 'month'
      ? <Text accessibilityRole="header" style={[visitStyles.eyebrow, styles.section]}>{item.title}</Text>
      : <VisitRow visit={item.visit} shared={shared.has(item.visit.localId)} isNew={isVisitNew(item.visit, seen)} isOpen={item.visit.localId === open} />} />;
}
const styles = StyleSheet.create({
  visit: { paddingVertical: 16, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: Gallery.separator },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  content: { flex: 1, alignSelf: 'stretch' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { flexShrink: 1, fontSize: 17, lineHeight: 25, fontWeight: '600', color: Gallery.ink },
  spacer: { flex: 1 },
  meta: { fontSize: 13, lineHeight: 18, color: Gallery.muted, marginTop: 2 },
  section: { color: Gallery.muted, paddingTop: 15, paddingBottom: 8, paddingHorizontal: 20 },
});
