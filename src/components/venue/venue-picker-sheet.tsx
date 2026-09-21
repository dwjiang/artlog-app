import { CollectionSearchField } from '../collection/collection-search-field';
import { searchVenues } from '@/lib/venue/search-venues';
import { venueLocation } from '@/lib/venue/venue-location';
import type { VenueRow } from '@/lib/venue/resolve';
import { EmptyState } from '../empty-state';
import { EmptyMap } from '../empty-state-art';
import { LoadingRing } from '@/components/loading-ring';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GalleryButton } from '@/components/collection/gallery-button';
import { ThemedText } from '@/components/themed-text';
import { ArtworkPreviews } from '@/components/visits/visit-ui';
import { Colors, Gallery, Radius, Spacing } from '@/constants/theme';
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
 * `mode=choose` opens the chooser even while a visit is paused elsewhere; continuing without a museum leaves that visit alone.
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
  const sheetStyle = useSheetStyle();
  const { status, options, error, confirm, dismiss } = view;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ query: string; rows: VenueRow[]; error?: string }>();
  const searching = query.trim().length >= 2;
  useEffect(() => {
    if (!searching) return;
    let active = true;
    const timer = setTimeout(() => { void searchVenues(query).then((rows) => { if (active) setResults({ query, rows }); })
      .catch(() => { if (active) setResults({ query, rows: [], error: 'Museums could not load. Try another search.' }); }); }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [query, searching]);
  const [busy, setBusy] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const searchInput = useRef<TextInput>(null);
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

  const hasQuery = !!query.trim();
  return <ScrollView style={sheetStyle} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
    <ThemedText type="title" accessibilityRole="header">Choose museum</ThemedText>
    <CollectionSearchField inputRef={searchInput} value={query} label="Search museums" placeholder="Museum or city" showLabel={false} filled onChange={setQuery} onClear={() => setQuery('')} />
    {hasQuery ? !searching ? <ThemedText themeColor="textSecondary">Enter at least two characters.</ThemedText>
      : results?.query !== query ? <LoadingRing accessibilityLabel="Searching museums" />
        : results.error ? <ThemedText themeColor="error" accessibilityRole="alert">{results.error}</ThemedText>
          : !results.rows.length ? <EmptyState inset={false} title="No museums found." detail="Try the city or a shorter name." visual={<EmptyMap />} />
            : results.rows.map((row) => <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={row.name} disabled={!!busy} onPress={() => { void choose({ kind: 'seeded', venueId: row.id, name: row.name, manual: true }); }} style={styles.option}>
              <Image source="sf:building.columns" tintColor={Gallery.muted} style={{ width: 22, height: 22 }} /><View style={styles.optionText}><ThemedText>{row.name}</ThemedText><ThemedText type="small" themeColor="textSecondary">{venueLocation(row).location}</ThemedText></View>{busy === row.id && <LoadingRing />}
            </Pressable>)
      : status === 'locating' ? <LoadingRing accessibilityLabel="Locating your museum" />
        : !options.length ? <EmptyState inset={false} title={status === 'denied' ? 'Find your museum, wherever you are.' : 'Art turns up everywhere.'} detail="Search by museum or city. You can also keep scanning without a museum." visual={<EmptyMap />}>
          <GalleryButton label="Search museums" variant="filled" fullWidth onPress={() => searchInput.current?.focus()} />
          {status === 'denied' && <GalleryButton label="Open Settings" fullWidth onPress={() => { void Linking.openSettings().catch(() => setFailure('Could not open Settings.')); }} />}
        </EmptyState>
          : <><ThemedText type="smallBold" themeColor="textSecondary">Nearby</ThemedText>{options.map((option, index) => <Pressable key={venueOptionKey(option)} accessibilityRole="button" accessibilityLabel={option.name} accessibilityState={{ busy: busy === venueOptionKey(option), disabled: !!busy }} disabled={!!busy} onPress={() => { void choose(option); }} style={[styles.option, styles.unselectedOption]}>
            <Image source="sf:building.columns" tintColor={Gallery.muted} style={{ width: 22, height: 22 }} /><View style={styles.optionText}><ThemedText>{option.name}</ThemedText><ThemedText type="small" themeColor="textSecondary">{detail(option, index === 0)}</ThemedText></View>{busy === venueOptionKey(option) && <LoadingRing />}
          </Pressable>)}</>}
    {(failure ?? error) && <ThemedText selectable themeColor="error" accessibilityRole="alert">{failure ?? error}</ThemedText>}
    <GalleryButton label={keepVisit ? 'Keep current visit' : 'Continue without a museum'} fullWidth onPress={keepVisit ?? notHere} />
  </ScrollView>;
}

const styles = StyleSheet.create({
  container: { flexGrow: 0, backgroundColor: Colors.light.background },
  content: { padding: Spacing.content, gap: Spacing.three },
  confirmationContent: { paddingTop: Spacing.five, gap: Spacing.four },
  heading: { gap: Spacing.two },
  placeCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three, backgroundColor: Gallery.fill, borderRadius: Radius.card, borderCurve: 'continuous' },
  placeIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: Gallery.highlight, borderRadius: Radius.card, borderCurve: 'continuous' },
  placeSymbol: { width: 26, height: 26 },
  actions: { gap: Spacing.two },
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
