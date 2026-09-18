import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { GalleryButton } from '@/components/collection/gallery-button';
import { ThemedText } from '@/components/themed-text';
import { Colors, Gallery, Spacing } from '@/constants/theme';
import { formatDistance } from '@/lib/venue/resolve';
import { useVenue } from '@/lib/venue/use-venue';
import { venueOptionKey, type VenueOption } from '@/lib/venue/venue-reducer';

function detail(option: VenueOption, current: boolean): string {
  const parts = [formatDistance(option.distanceM ?? Number.NaN)];
  if (option.kind === 'poi' && option.category !== 'unknown') parts.push(option.category);
  if (current) parts.push('current');
  return parts.filter(Boolean).join(' · ');
}

export function VenuePickerSheet() {
  const router = useRouter();
  const { fontScale } = useWindowDimensions();
  const { status, venue, options, error, confirm, dismiss } = useVenue();
  const [busy, setBusy] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const pending = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => pending.current?.abort(), []);

  async function choose(option: VenueOption) {
    if (pending.current) return;
    const request = new AbortController();
    pending.current = request;
    setBusy(venueOptionKey(option));
    setFailure(undefined);
    try {
      await confirm(option, request.signal);
      if (!request.signal.aborted) router.back();
    } catch (cause) {
      if (!request.signal.aborted) setFailure(cause instanceof Error ? cause.message : 'Could not confirm the venue. Try again.');
    } finally {
      if (!request.signal.aborted) setBusy(undefined);
      if (pending.current === request) pending.current = undefined;
    }
  }

  function notHere() {
    pending.current?.abort();
    dismiss();
    router.back();
  }

  const title = status === 'locating' ? 'Finding your museum…'
    : status === 'denied' ? 'Location is off'
    : options.length > 0 ? 'Looks like you’re at…'
    : 'No museum nearby';
  const explanation = status === 'denied'
    ? 'Allow location access while using Artlog so scans are matched against the museum you are in. Your coordinates never leave the phone.'
    : options.length > 0
      ? 'Confirm the museum so scans are matched against its collection.'
      : status === 'locating' ? undefined : 'Nothing seeded or on the map is within a few hundred metres. Scans still search the whole index.';

  // The scroll view stays the root: react-native-screens sizes a form sheet's first-child scroll view to the sheet.
  return (
    <ScrollView style={styles.container} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <ThemedText type={status === 'locating' && fontScale > 1.5 ? 'subtitle' : 'title'} style={status === 'locating' && styles.loadingTitle}>{title}</ThemedText>
        {status === 'locating' && <ActivityIndicator color={Gallery.accent} accessibilityLabel="Locating your museum" />}
        {explanation && <ThemedText themeColor="textSecondary">{explanation}</ThemedText>}
        {status === 'denied' && <GalleryButton label="Open Settings" variant="outlined" onPress={() => { void Linking.openSettings().catch(() => setFailure('Could not open Settings.')); }} />}
        {options.map((option) => {
          const key = venueOptionKey(option);
          const current = option.kind === 'seeded' && option.venueId === venue?.venueId;
          const confirming = busy === key;
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={option.name}
              accessibilityState={{ selected: current, busy: confirming, disabled: busy !== undefined }}
              disabled={busy !== undefined}
              onPress={() => { void choose(option); }}
              style={({ pressed }) => [styles.option, current && styles.currentOption, (pressed || confirming) && styles.pressedOption]}
            >
              <View style={styles.optionText}>
                <ThemedText style={current && styles.selectedLabel}>{option.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{confirming ? 'Confirming…' : detail(option, current)}</ThemedText>
              </View>
              {confirming && <ActivityIndicator color={Gallery.accent} />}
            </Pressable>
          );
        })}
        {(failure ?? error) && <ThemedText selectable themeColor="error" accessibilityRole="alert">{failure ?? error}</ThemedText>}
        {status !== 'locating' && <GalleryButton label={options.length > 0 ? 'Not here' : 'OK'} variant="outlined" fullWidth onPress={notHere} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  content: { padding: Spacing.content, gap: Spacing.three },
  loadingTitle: { textAlign: 'center' },
  option: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Gallery.separator },
  currentOption: { backgroundColor: Gallery.highlight, borderWidth: 1, borderColor: Gallery.ink },
  pressedOption: { opacity: 0.6 },
  optionText: { flex: 1, gap: Spacing.half },
  selectedLabel: { fontWeight: '600' },
});
