import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { GalleryButton } from '../collection/gallery-button';
import { ThemedText } from '@/components/themed-text';
import { Gallery, Spacing } from '@/constants/theme';
import { getSetting } from '@/db/repos/settings';
import { listVisits } from '@/db/repos/visits';
import { captureOwner, useLocalOwner } from '@/lib/account/owner-store';
import { readPhotoSession, updatePhotoSession } from '@/lib/capture/photo-draft';
import { captureVisitKey, setCaptureVisit } from '@/lib/capture/visit-context';
import { formatVisitDate } from '@/lib/journal/history';

export function CaptureContextScreen() {
  const owner = useLocalOwner();
  const { draftId, visitId } = useLocalSearchParams<{ draftId?: string; visitId?: string }>();
  return <CaptureContext key={`${owner}:${draftId ?? 'next'}`} owner={owner} draftId={draftId} visitId={visitId} />;
}

function CaptureContext({ owner, draftId, visitId }: { owner: string; draftId?: string; visitId?: string }) {
  const visits = useLiveQuery(listVisits(owner), [owner]);
  const [selected, setSelected] = useState<string>();
  const [selectionLoaded, setSelectionLoaded] = useState(false);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  const choosing = useRef(false);
  const availableVisits = visits.data.filter((visit) => visit.owner === owner);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const session = draftId ? readPhotoSession(owner, draftId) : undefined;
        const value = session
          ? session.visitLocalId === null ? 'none' : session.visitLocalId ?? session.saveInput?.capture?.visitLocalId ?? visitId ?? 'none'
          : await getSetting(captureVisitKey(owner)) ?? 'auto';
        if (active) setSelected(value ?? undefined);
      } catch {
        if (active) setError('Couldn’t load your current selection. Choose a visit below.');
      } finally {
        if (active) setSelectionLoaded(true);
      }
    }
    void load();
    return () => { active = false; };
  }, [owner, draftId, visitId]);

  async function choose(value: string) {
    if (choosing.current) return;
    choosing.current = true;
    const account = captureOwner();
    setPending(value);
    setError(undefined);
    try {
      if (draftId) updatePhotoSession(owner, draftId, { visitLocalId: value === 'none' ? null : value });
      else await setCaptureVisit(value, owner);
      if (account.isOwnerCurrent()) router.back();
    } catch {
      if (account.isOwnerCurrent()) setError('Couldn’t save this visit choice. Your previous selection is unchanged. Try again.');
    } finally {
      choosing.current = false;
      if (account.isOwnerCurrent()) setPending(undefined);
    }
  }

  function option(value: string, label: string, detail?: string) {
    const current = selected === value;
    return <Pressable key={value} accessibilityRole="button" accessibilityLabel={detail ? `${label} · ${detail}` : label}
      accessibilityState={{ selected: current, busy: pending === value, disabled: pending !== undefined }}
      disabled={pending !== undefined} onPress={() => { void choose(value); }}
      style={({ pressed }) => [styles.option, current && styles.selected, pressed && styles.pressed]}>
      <View style={styles.optionText}>
        <ThemedText style={current && styles.selectedLabel}>{label}</ThemedText>
        {detail && <ThemedText type="small" themeColor="textSecondary">{detail}</ThemedText>}
        {current && <ThemedText type="smallBold">Selected</ThemedText>}
      </View>
      {pending === value && <ActivityIndicator color={Gallery.accent} accessibilityLabel="Saving visit choice" />}
    </Pressable>;
  }

  return <ScrollView style={styles.screen} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
    <Stack.Screen options={{ title: 'Save this moment to…' }} />
    <ThemedText themeColor="textSecondary">{draftId ? 'New photos use this visit. Earlier photos and encounters stay where they are.' : 'Choose the visit for your next captures. Photos retain their capture date.'}</ThemedText>
    {!selectionLoaded && <ThemedText themeColor="textSecondary">Loading current selection…</ThemedText>}
    {error && <ThemedText themeColor="error" accessibilityRole="alert">{error}</ThemedText>}
    <View>
      {!draftId && option('auto', 'Current museum visit')}
      {option('none', 'No visit · Save artwork only')}
    </View>
    <GalleryButton label="Create a visit" icon="plus" disabled={pending !== undefined} onPress={() => router.push('/visit-create')} />
    <ThemedText type="subtitle">Your visits</ThemedText>
    {visits.error ? <ThemedText themeColor="error" accessibilityRole="alert">Couldn’t load your visits. Close this screen and reopen it to try again.</ThemedText>
      : !visits.updatedAt ? <View style={styles.loading}><ActivityIndicator color={Gallery.accent} /><ThemedText themeColor="textSecondary" style={{ flex: 1 }}>Loading visits…</ThemedText></View>
      : availableVisits.length === 0 && <ThemedText themeColor="textSecondary">No visits yet. Create a visit, or save this artwork without one.</ThemedText>}
    <View>{availableVisits.map((visit) => option(visit.localId, visit.venueName, formatVisitDate(visit.visitedOn)))}</View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Gallery.paper },
  content: { padding: Spacing.content, gap: Spacing.four },
  option: { minHeight: 44, flexDirection: 'row', alignItems: 'center', padding: Spacing.three, gap: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Gallery.separator },
  optionText: { flex: 1, gap: Spacing.one },
  selected: { backgroundColor: Gallery.highlight, borderWidth: 1, borderColor: Gallery.ink },
  selectedLabel: { fontWeight: '600' },
  pressed: { opacity: 0.7 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
