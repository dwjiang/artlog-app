import { Host } from '@expo/ui';
import { DatePicker } from '@expo/ui/swift-ui';
import { datePickerStyle, tint } from '@expo/ui/swift-ui/modifiers';
import { randomUUID } from 'expo-crypto';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, TextInput, View } from 'react-native';
import { ThemedText as Text } from '@/components/themed-text';
import { Gallery } from '@/constants/theme';
import { patchVisit, upsertVisit } from '@/db/repos/visits';
import { captureOwner, useLocalOwner } from '@/lib/account/owner-store';
import { venueLocation } from '@/lib/venue/venue-location';
import { useVisits } from '@/lib/journal/use-visits';
import { dateFromPicker, pickerDate, validVisitDate, venueTimeZone } from '@/lib/journal/visit-date';
import type { VisitSummary } from '@/lib/journal/visit-summaries';
import type { VenueRow } from '@/lib/venue/resolve';
import { MUSEUM_SEARCH_LIMIT, searchVenues } from '@/lib/venue/search-venues';
import { calendarDate, LIMITS } from '@/shared/journal/limits';
import { socialErrorMessage } from '@/shared/social/errors';
import { showToast } from '@/lib/ui/toast';
import { GalleryButton } from '../collection/gallery-button';
import { VisitMessage, VisitPage, visitStyles as styles } from './visit-ui';

export function VisitCreateScreen() {
  const owner = useLocalOwner();
  const { savedId } = useLocalSearchParams<{ savedId?: string }>();
  return <CreateForm key={`${owner}:${savedId ?? ''}`} savedId={savedId} />;
}
function CreateForm({ savedId }: { savedId?: string }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ query: string; retry: number; rows: VenueRow[]; error?: string }>();
  const [venue, setVenue] = useState<VenueRow>();
  const [retry, setRetry] = useState(0);
  const [now] = useState(Date.now);
  const [date, setDate] = useState(() => dateFromPicker(new Date(now)));
  const [reflection, setReflection] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const submitting = useRef(false);
  const [localId] = useState(randomUUID);
  const timeZone = venue ? venueTimeZone(venue) : Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = calendarDate(now, timeZone);
  const validDate = validVisitDate(date, timeZone, now);
  const currentResults = results?.query === query && results.retry === retry ? results : undefined;
  const venues = currentResults?.rows ?? [];
  const searchError = currentResults?.error;
  const searching = !venue && query.trim().length >= 2 && !currentResults;
  useEffect(() => {
    let active = true;
    if (venue || query.trim().length < 2) return;
    const timer = setTimeout(() => {
      void searchVenues(query).then((rows) => { if (active) setResults({ query, retry, rows }); })
        .catch(() => { if (active) setResults({ query, retry, rows: [], error: 'Museums could not load. Try again.' }); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [query, venue, retry]);
  function chooseVenue(row: VenueRow) {
    setVenue(row); Keyboard.dismiss();
    // The device may already be on a later calendar day than the museum.
    const museumToday = calendarDate(now, venueTimeZone(row));
    setDate((current) => current > museumToday ? museumToday : current);
  }
  async function save() {
    if (!venue || submitting.current || !validDate) return;
    const session = captureOwner();
    submitting.current = true; setBusy(true); setError(undefined); Keyboard.dismiss();
    try {
      await upsertVisit({ localId, venueId: venue.id, venueName: venue.name, visitedOn: date, timeZone, reflection: reflection.trim() || null }, session.owner, savedId);
      if (session.isOwnerCurrent()) {
        showToast(savedId ? 'New visit linked. Other photos are unchanged.' : 'Visit saved privately. No artwork needed.');
        if (savedId) router.dismissTo({ pathname: '/saved/[savedId]', params: { savedId, visitId: localId } });
        else router.back();
      }
    } catch (cause) { if (session.isOwnerCurrent()) setError(socialErrorMessage(cause) ?? 'Your visit could not be saved. Try again.'); }
    finally { if (session.isOwnerCurrent()) { submitting.current = false; setBusy(false); } }
  }
  return <>
    <Stack.Toolbar placement="left"><Stack.Toolbar.Button onPress={() => router.back()} disabled={busy}>Cancel</Stack.Toolbar.Button></Stack.Toolbar>
    <Stack.Toolbar placement="right"><Stack.Toolbar.Button variant="done" disabled={busy || !venue || !validDate} onPress={() => { void save(); }}>{busy ? 'Saving…' : 'Save'}</Stack.Toolbar.Button></Stack.Toolbar>
    <VisitPage>
      <Text style={[styles.title, { letterSpacing: -0.8 }]}>Keep the visit.</Text>
      <Text style={styles.caption}>{savedId ? 'This visit will be linked to your artwork when you save.' : 'A visit is yours to remember, with or without artworks.'}</Text>
      <Text accessibilityRole="header" style={styles.heading}>Museum</Text>
      {venue ? <View style={styles.card}>
        <Text style={styles.body}>{venue.name}</Text><Text style={styles.caption}>{venueLocation(venue).location}</Text>
        <GalleryButton label="Change museum" disabled={busy} onPress={() => setVenue(undefined)} />
      </View> : <>
        <TextInput keyboardAppearance="light" selectionColor={Gallery.accent} placeholderTextColor={Gallery.muted} accessibilityLabel="Search museums" placeholder="Museum or city" value={query} maxLength={LIMITS.searchMax}
          onChangeText={setQuery} autoCorrect={false} style={styles.input} returnKeyType="search" />
        {searching ? <VisitMessage loading>Searching museums…</VisitMessage> : searchError ? <VisitMessage action="Try again" onAction={() => setRetry((value) => value + 1)}>{searchError}</VisitMessage>
          : query.trim().length < 2 ? <Text style={styles.caption}>Enter at least two characters.</Text>
          : !venues.length ? <Text style={styles.caption}>No museums match. Try the city or a shorter name.</Text> : null}
        {venues.map((row) => <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={`${row.name}, ${venueLocation(row).location || row.name}`}
          style={styles.card} onPress={() => chooseVenue(row)}>
          <Text style={styles.body}>{row.name}</Text><Text style={styles.caption}>{venueLocation(row).location}</Text>
        </Pressable>)}
        {venues.length === MUSEUM_SEARCH_LIMIT && <Text style={styles.caption}>Showing the first {MUSEUM_SEARCH_LIMIT} museums. Add a city or more of the name to narrow your search.</Text>}
      </>}
      <Host matchContents={{ vertical: true }} colorScheme="light">
        <DatePicker title="Visit date" selection={pickerDate(date)} range={{ end: pickerDate(today) }} displayedComponents={['date']}
          onDateChange={(value) => setDate(dateFromPicker(value))} modifiers={[datePickerStyle('compact'), tint(Gallery.accent)]} />
      </Host>
      {!validDate && <Text accessibilityRole="alert" style={styles.error}>Choose today or an earlier date at this museum.</Text>}
      <Text accessibilityRole="header" style={styles.heading}>Private reflection</Text>
      <TextInput keyboardAppearance="light" selectionColor={Gallery.accent} placeholderTextColor={Gallery.muted} accessibilityLabel="Private reflection" placeholder="What stayed with you? (optional)" value={reflection} onChangeText={setReflection}
        multiline maxLength={LIMITS.note} editable={!busy} style={[styles.input, styles.reflection]} />
      <Text style={styles.caption}>Only you can see this reflection.</Text>
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    </VisitPage>
  </>;
}

export function VisitReflectionScreen() {
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const { owner, visits, loading } = useVisits();
  const visit = visits.find((row) => row.localId === visitId);
  if (!visit) return <VisitPage><VisitMessage loading={loading} action="Done" onAction={() => router.back()}>{loading ? 'Loading reflection…' : 'This visit is unavailable.'}</VisitMessage></VisitPage>;
  return <ReflectionForm key={`${owner}:${visitId}`} visit={visit} />;
}
function ReflectionForm({ visit }: { visit: VisitSummary }) {
  const [reflection, setReflection] = useState(visit.reflection ?? '');
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const submitting = useRef(false);
  async function save() {
    if (submitting.current) return;
    const session = captureOwner();
    if (session.owner !== visit.owner) return;
    submitting.current = true; setBusy(true); setError(undefined); Keyboard.dismiss();
    try {
      await patchVisit(visit.localId, { reflection: reflection.trim() || null }, session.owner);
      if (session.isOwnerCurrent()) { showToast('Private reflection saved.'); router.back(); }
    } catch (cause) { if (session.isOwnerCurrent()) setError(socialErrorMessage(cause) ?? 'Your reflection could not be saved. Try again.'); }
    finally { if (session.isOwnerCurrent()) { submitting.current = false; setBusy(false); } }
  }
  return <>
    <Stack.Toolbar placement="left"><Stack.Toolbar.Button disabled={busy} onPress={() => router.back()}>Cancel</Stack.Toolbar.Button></Stack.Toolbar>
    <Stack.Toolbar placement="right"><Stack.Toolbar.Button variant="done" disabled={busy} onPress={() => { void save(); }}>{busy ? 'Saving…' : 'Save'}</Stack.Toolbar.Button></Stack.Toolbar>
    <VisitPage><Text style={[styles.title, { letterSpacing: -0.8 }]}>Just for you.</Text><Text style={styles.caption}>{visit.venueName}</Text>
      <TextInput keyboardAppearance="light" selectionColor={Gallery.accent} placeholderTextColor={Gallery.muted} accessibilityLabel="Private reflection" value={reflection} onChangeText={setReflection} multiline maxLength={LIMITS.note}
        editable={!busy} style={[styles.input, styles.reflection]} autoFocus />
      <Text style={styles.caption}>Only you can see this reflection. Sharing uses a separate reflection you write yourself.</Text>
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    </VisitPage>
  </>;
}
