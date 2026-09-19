import { LoadingRing } from '@/components/loading-ring';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GalleryButton } from '@/components/collection/gallery-button';
import { ThemedText } from '@/components/themed-text';
import { ArtworkPreviews } from '@/components/visits/visit-ui';
import { Colors, Gallery, Spacing } from '@/constants/theme';
import { useVisits } from '@/lib/journal/use-visits';
import { formatVisitStart } from '@/lib/journal/use-visit-works';
import { formatDistance } from '@/lib/venue/resolve';
import { useVenue, type VenueView } from '@/lib/venue/use-venue';
import { venueOptionKey, type CurrentVisit, type VenueOption } from '@/lib/venue/venue-reducer';

/**
 * `fitToContents` derives the sheet height from this scroll view, so an uncapped one grows past the
 * tallest detent and the sheet then stops scrolling short of its own end at large text sizes.
 */
function useSheetStyle() {
  const { height } = useWindowDimensions();
  const { top } = useSafeAreaInsets();
  return [styles.container, { maxHeight: height - top }];
}

function detail(option: VenueOption, nearest: boolean): string {
  const parts = [formatDistance(option.distanceM ?? Number.NaN)];
  if (option.kind === 'poi' && option.category !== 'unknown') parts.push(option.category);
  if (nearest) parts.push('nearest');
  return parts.filter(Boolean).join(' · ');
}

/**
 * One sheet for the venue pill, the visit bar and the location prompt: the open visit, or the museum chooser.
 * `mode=choose` opens the chooser even while a visit is paused elsewhere; "Not here" then leaves that visit alone.
 */
export function VenuePickerSheet() {
  const view = useVenue();
  const { mode: requested } = useLocalSearchParams<{ mode?: string }>();
  const visit = view.visit;
  // The mode is fixed when the sheet opens: a confirmation in the chooser closes the sheet rather than flipping it.
  const [mode, setMode] = useState<'visit' | 'change' | 'choose'>(visit && requested !== 'choose' ? 'visit' : 'choose');
  if (mode === 'visit' && visit && view.status !== 'denied') return <VisitSheet visit={visit} view={view} onChange={() => setMode('change')} />;
  return <ChooserSheet view={view} keepVisit={visit && mode === 'change' ? () => setMode('visit') : undefined} />;
}

function VisitSheet({ visit, view, onChange }: { visit: CurrentVisit; view: VenueView; onChange: () => void }) {
  const router = useRouter();
  const { visits } = useVisits();
  const summary = visits.find((row) => row.localId === visit.localId);
  const works = summary?.works ?? [];
  const sheetStyle = useSheetStyle();
  const [ending, setEnding] = useState(false);
  const [failure, setFailure] = useState<string>();
  const count = `${works.length} ${works.length === 1 ? 'artwork' : 'artworks'} this visit`;
  const openVisit = () => router.replace({ pathname: '/journal/[visitId]', params: { visitId: visit.localId } });
  async function endVisit() {
    setEnding(true);
    setFailure(undefined);
    try {
      await view.end();
      openVisit();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Could not end the visit. Try again.');
      setEnding(false);
    }
  }
  return (
    <ScrollView style={sheetStyle} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content} bounces={false}>
      <View style={styles.eyebrowRow}>
        <View style={styles.dot} />
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.eyebrow}>Visiting now · since {formatVisitStart(visit.startedAt, visit.timeZone)}</ThemedText>
      </View>
      <ThemedText type="title" accessibilityRole="header">{visit.venueName}</ThemedText>
      <ThemedText themeColor="textSecondary">{summary?.location ? `${summary.location} · ${count}` : count}</ThemedText>
      {works.length > 0 && <ArtworkPreviews works={works} overflow />}
      {failure && <ThemedText selectable themeColor="error" accessibilityRole="alert">{failure}</ThemedText>}
      <GalleryButton label="End visit" variant="filled" fullWidth busy={ending} busyLabel="Ending visit…" onPress={() => { void endVisit(); }} />
      <GalleryButton label="Change museum" variant="outlined" fullWidth disabled={ending} onPress={onChange} />
      <GalleryButton label="Open visit" icon="chevron.right" iconPosition="trailing" disabled={ending} onPress={openVisit} />
    </ScrollView>
  );
}

function ChooserSheet({ view, keepVisit }: { view: VenueView; keepVisit?: () => void }) {
  const router = useRouter();
  const { fontScale } = useWindowDimensions();
  const sheetStyle = useSheetStyle();
  const { status, options, error, confirm, dismiss } = view;
  const [busy, setBusy] = useState<string>();
  const [failure, setFailure] = useState<string>();
  // The nearest candidate is selected until the person picks another; a new set of options starts over.
  const [selection, setSelection] = useState<{ key: string; among: string }>();
  const pending = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => pending.current?.abort(), []);
  const optionKeys = options.map(venueOptionKey).join('|');
  const selectedKey = selection?.among === optionKeys ? selection.key : undefined;
  const setSelectedKey = (key: string) => setSelection({ key, among: optionKeys });
  const selected = options.find((option) => venueOptionKey(option) === selectedKey) ?? options[0];

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

  const single = options.length === 1 ? options[0] : undefined;
  const title = status === 'locating' ? 'Finding your museum…'
    : status === 'denied' ? 'Location is off'
    : options.length === 0 ? 'No museum nearby'
    : options.some((option) => option.kind === 'poi') ? 'Looks like you’re at…'
    : single ? `Still at ${single.name}?`
    : `${options.length} museums nearby`;
  const explanation = status === 'denied'
    ? 'Allow location access while using Artlog so scans are matched against the museum you are in. Your coordinates never leave the phone.'
    : options.length > 1
      ? 'The nearest one is selected. Scans are matched against the museum you confirm.'
      : single
        ? 'Scans are matched against the museum you confirm.'
        : status === 'locating' ? undefined : 'Nothing seeded or on the map is within a few hundred metres. Scans still search the whole index.';

  // The scroll view stays the root: react-native-screens sizes a form sheet's first-child scroll view to the sheet.
  return (
    <ScrollView style={sheetStyle} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content} bounces={false}>
        <ThemedText type={status === 'locating' && fontScale > 1.5 ? 'subtitle' : 'title'} accessibilityRole="header" style={status === 'locating' && styles.loadingTitle}>{title}</ThemedText>
        {status === 'locating' && <LoadingRing color={Gallery.accent} accessibilityLabel="Locating your museum" />}
        {explanation && <ThemedText themeColor="textSecondary">{explanation}</ThemedText>}
        {status === 'denied' && <GalleryButton label="Open Settings" variant="outlined" onPress={() => { void Linking.openSettings().catch(() => setFailure('Could not open Settings.')); }} />}
        {options.map((option, index) => {
          const key = venueOptionKey(option);
          const isSelected = selected !== undefined && venueOptionKey(selected) === key;
          const confirming = busy === key;
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={option.name}
              accessibilityState={{ selected: isSelected, busy: confirming, disabled: busy !== undefined }}
              disabled={busy !== undefined}
              onPress={() => setSelectedKey(key)}
              style={({ pressed }) => [styles.option, isSelected ? styles.selectedOption : styles.unselectedOption, (pressed || confirming) && styles.pressedOption]}
            >
              <View style={styles.optionText}>
                <ThemedText style={isSelected && styles.selectedLabel}>{option.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{confirming ? 'Confirming…' : detail(option, index === 0 && options.length > 1)}</ThemedText>
              </View>
              {confirming && <LoadingRing color={Gallery.accent} />}
            </Pressable>
          );
        })}
        {(failure ?? error) && <ThemedText selectable themeColor="error" accessibilityRole="alert">{failure ?? error}</ThemedText>}
        {selected && status !== 'locating' && <GalleryButton label={`Confirm ${selected.name}`} variant="filled" fullWidth busy={busy !== undefined} busyLabel="Confirming…" onPress={() => { void choose(selected); }} />}
        {keepVisit ? <GalleryButton label="Keep current visit" variant="outlined" fullWidth disabled={busy !== undefined} onPress={keepVisit} />
          : status !== 'locating' && <GalleryButton label={options.length > 0 ? 'Not here' : 'OK'} variant="outlined" fullWidth onPress={notHere} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 0, backgroundColor: Colors.light.background },
  content: { padding: Spacing.content, gap: Spacing.three },
  loadingTitle: { textAlign: 'center' },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  eyebrow: { letterSpacing: 1.1, textTransform: 'uppercase' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Gallery.success },
  option: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.three },
  unselectedOption: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Gallery.separator },
  selectedOption: { backgroundColor: Gallery.highlight, borderWidth: 1, borderColor: Gallery.ink },
  pressedOption: { opacity: 0.6 },
  optionText: { flex: 1, gap: Spacing.half },
  selectedLabel: { fontWeight: '600' },
});
