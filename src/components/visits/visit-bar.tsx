import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Gallery, Spacing } from '@/constants/theme';
import { useLocalOwner } from '@/lib/account/owner-store';
import { cropSyncing } from '@/lib/account/photo-sync';
import { useVisitWorks } from '@/lib/journal/use-visit-works';
import { useVenue } from '@/lib/venue/use-venue';
import { SavedWorkImage } from '../collection/saved-work-image';
import { VisitSymbol } from './visit-ui';

/**
 * The tab bar's accessory while a visit is open: museum, artwork count, and End. `compact` is the
 * inline placement next to a minimized tab bar, where only the name fits.
 */
export function VisitBar({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const owner = useLocalOwner();
  const { visit, end } = useVenue();
  const works = useVisitWorks(visit?.localId, owner);
  const [ending, setEnding] = useState(false);
  if (!visit) return null;
  const count = `${works.length} ${works.length === 1 ? 'artwork' : 'artworks'}`;
  const cover = works[0];
  const visitId = visit.localId;
  async function endVisit() {
    if (ending) return;
    setEnding(true);
    try {
      await end();
      router.push({ pathname: '/journal/[visitId]', params: { visitId } });
    } catch (error) {
      console.warn('Could not end the visit', error);
    } finally {
      setEnding(false);
    }
  }
  return (
    <View style={styles.bar}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Visiting ${visit.venueName}, ${count}`} accessibilityHint="Opens the visit sheet"
        onPress={() => router.push('/venue-picker')} style={({ pressed }) => [styles.summary, pressed && styles.pressed]}>
        <View style={styles.art}>
          {cover ? <SavedWorkImage path={cover.cropPath} syncing={cropSyncing(cover)} title={cover.title} contain style={styles.artImage} />
            : <VisitSymbol name="building.columns" size={18} color={Gallery.ink} />}
        </View>
        <View style={styles.text}>
          <View style={styles.nameRow}>
            <View style={styles.dot} />
            <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>{visit.venueName}</ThemedText>
          </View>
          {!compact && <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>Visiting now · {count}</ThemedText>}
        </View>
      </Pressable>
      {!compact && <Pressable accessibilityRole="button" accessibilityLabel="End visit" accessibilityState={{ busy: ending, disabled: ending }} disabled={ending}
        onPress={() => { void endVisit(); }} style={({ pressed }) => [styles.end, pressed && styles.pressed]}>
        <ThemedText type="smallBold" style={styles.endLabel}>{ending ? 'Ending…' : 'End'}</ThemedText>
      </Pressable>}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.compact, paddingLeft: Spacing.compact, paddingRight: Spacing.two },
  summary: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.compact },
  pressed: { opacity: 0.6 },
  art: { width: 36, height: 36, borderRadius: 18, overflow: 'hidden', backgroundColor: Gallery.fill, alignItems: 'center', justifyContent: 'center' },
  artImage: { width: '100%', height: '100%' },
  text: { flex: 1, gap: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Gallery.success },
  name: { flexShrink: 1, fontSize: 15, lineHeight: 19 },
  end: { minHeight: 36, paddingHorizontal: Spacing.three, borderRadius: 18, backgroundColor: Gallery.surface, alignItems: 'center', justifyContent: 'center' },
  endLabel: { color: Gallery.accent, fontSize: 15 },
});
