import { TextSkeleton } from '@/components/loading-skeleton';
import { LoadingRing } from '@/components/loading-ring';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { GlassSurface } from '@/components/glass-surface';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { useLocalOwner } from '@/lib/account/owner-store';
import { useVisitWorks } from '@/lib/journal/use-visit-works';
import { useVenue, type VenueView } from '@/lib/venue/use-venue';

export function venuePillLabel({ status, venue }: Pick<VenueView, 'status' | 'venue'>): string {
  if (venue) return venue.name;
  switch (status) {
    case 'choose': return 'Which museum?';
    case 'none': return 'No museum nearby';
    case 'denied': return 'Location is off';
    default: return 'Finding your museum…';
  }
}

/** The camera's one line about the visit: the museum scans match, and how many artworks the open visit holds. Opens the visit sheet. */
export function VenuePill() {
  const router = useRouter();
  const owner = useLocalOwner();
  const { status, venue, visit } = useVenue();
  const label = venuePillLabel({ status, venue });
  const active = !!visit && visit.venueId === venue?.venueId;
  const { works, loading, error } = useVisitWorks(active ? visit.localId : undefined, owner);
  const locating = !venue && (status === 'idle' || status === 'locating');
  const accessibilityLabel = active && !loading && !error ? `${label}, visiting now, ${works.length} ${works.length === 1 ? 'artwork' : 'artworks'}` : label;
  return (
    <GlassSurface isInteractive style={styles.pill}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint="Opens the visit sheet"
        accessibilityState={{ disabled: locating, busy: locating }}
        disabled={locating}
        onPress={() => router.push('/venue-picker')}
        style={({ pressed }) => [styles.content, pressed && styles.pressed]}
      >
        {!active && <Image source="sf:building.columns" style={styles.icon} tintColor={Colors.light.overlayText} />}
        {locating ? <LoadingRing accessibilityLabel={label} color={Colors.light.overlayText} /> : <ThemedText type="smallBold" themeColor="overlayText" style={styles.label}>{label}</ThemedText>}
        {active && (loading ? <TextSkeleton label="Loading visit artwork count" width={24} /> : !error && <ThemedText type="small" themeColor="overlayText" style={styles.count}>· {works.length}</ThemedText>)}
        <Image source="sf:chevron.down" style={styles.chevron} tintColor={Colors.light.overlayText} accessible={false} />
      </Pressable>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  pill: { flexShrink: 1, borderRadius: Spacing.four, overflow: 'hidden' },
  content: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two + Spacing.half, paddingHorizontal: Spacing.three },
  pressed: { opacity: 0.6 },
  icon: { width: 18, height: 18 },
  chevron: { width: 12, height: 12 },
  label: { flexShrink: 1 },
  count: { opacity: 0.8 },
});
