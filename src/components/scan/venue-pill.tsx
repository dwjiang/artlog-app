import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { GlassSurface } from '@/components/glass-surface';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
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

export function VenuePill() {
  const router = useRouter();
  const { status, venue } = useVenue();
  const label = venuePillLabel({ status, venue });
  const locating = !venue && (status === 'idle' || status === 'locating');
  return (
    <GlassSurface isInteractive style={styles.pill}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Opens the museum picker"
        accessibilityState={{ disabled: locating, busy: locating }}
        disabled={locating}
        onPress={() => router.push('/venue-picker')}
        style={({ pressed }) => [styles.content, pressed && styles.pressed]}
      >
        <Image source="sf:building.columns" style={styles.icon} tintColor={Colors.light.overlayText} />
        <ThemedText type="smallBold" themeColor="overlayText" numberOfLines={1} style={styles.label}>{label}</ThemedText>
      </Pressable>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  pill: { flexShrink: 1, borderRadius: Spacing.four, overflow: 'hidden' },
  content: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two + Spacing.half, paddingHorizontal: Spacing.three },
  pressed: { opacity: 0.6 },
  icon: { width: 18, height: 18 },
  label: { flexShrink: 1 },
});
