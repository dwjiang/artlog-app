import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Gallery, Radius, Spacing, Typography } from '@/constants/theme';
import { useLocalOwner } from '@/lib/account/owner-store';
import { useVisitWorks } from '@/lib/journal/use-visit-works';
import { useVenue } from '@/lib/venue/use-venue';

/**
 * The tab bar's accessory while a visit is open: museum, artwork count, and End. `compact` is the
 * inline placement next to a minimized tab bar, where only the name fits.
 */
export function VisitBar({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const owner = useLocalOwner();
  const { visit } = useVenue();
  const works = useVisitWorks(visit?.localId, owner);
  if (!visit) return null;
  const count = `${works.length} ${works.length === 1 ? 'artwork' : 'artworks'}`;
  const visitId = visit.localId;
  return (
    <View style={[styles.bar, compact && styles.compact]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Visiting ${visit.venueName}, ${count}`} accessibilityHint="Opens the current visit"
        onPress={() => router.push({ pathname: '/journal/[visitId]', params: { visitId } })} style={({ pressed }) => [styles.summary, pressed && styles.pressed]}>
        <View style={styles.text}>
          {!compact && <ThemedText variant="metadata" themeColor="textSecondary" numberOfLines={1}>Visiting now · {count} saved</ThemedText>}
          <ThemedText numberOfLines={1} style={styles.name}>{visit.venueName}</ThemedText>
        </View>
      </Pressable>
      {!compact && <Pressable accessibilityRole="button" accessibilityLabel="End visit"
        onPress={() => router.push({ pathname: '/journal/[visitId]', params: { visitId, endVisit: 'true' } })} style={({ pressed }) => [styles.end, pressed && styles.pressed]}>
        <ThemedText variant="metadata" style={styles.endLabel}>End visit</ThemedText>
      </Pressable>}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.compact, backgroundColor: Gallery.surface, borderRadius: Radius.card, borderCurve: 'continuous' },
  compact: { paddingHorizontal: Spacing.two },
  summary: { flex: 1, minHeight: 44, justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  text: { gap: Spacing.half },
  name: { ...Typography.secondary, fontWeight: '600' },
  end: { minHeight: 44, paddingHorizontal: Spacing.compact, borderRadius: Radius.button, borderCurve: 'continuous', backgroundColor: Gallery.accent, alignItems: 'center', justifyContent: 'center' },
  endLabel: { color: Gallery.surface, fontWeight: '600' },
});
