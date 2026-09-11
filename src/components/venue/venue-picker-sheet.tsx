import { Button, Host } from '@expo/ui';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <ThemedText type="subtitle">{title}</ThemedText>
        {explanation && <ThemedText themeColor="textSecondary">{explanation}</ThemedText>}
        {status === 'denied' && (
          <Host matchContents colorScheme="light">
            <Button label="Open Settings" onPress={() => { void Linking.openSettings().catch(() => setFailure('Could not open Settings.')); }} />
          </Host>
        )}
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
                <ThemedText>{option.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{confirming ? 'Confirming…' : detail(option, current)}</ThemedText>
              </View>
            </Pressable>
          );
        })}
        {(failure ?? error) && <ThemedText selectable>{failure ?? error}</ThemedText>}
        {status !== 'locating' && (
          <Host matchContents colorScheme="light">
            <Button label={options.length > 0 ? 'Not here' : 'OK'} onPress={notHere} />
          </Host>
        )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  content: { padding: Spacing.four, gap: Spacing.three },
  option: { borderRadius: Spacing.three, padding: Spacing.three, backgroundColor: Colors.light.backgroundElement },
  currentOption: { backgroundColor: Colors.light.backgroundSelected },
  pressedOption: { opacity: 0.6 },
  optionText: { gap: Spacing.half },
});
