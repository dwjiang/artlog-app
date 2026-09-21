import { EmptyState } from '../empty-state';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { GalleryButton } from '../collection/gallery-button';
import { ListSkeleton } from '@/components/loading-skeleton';
import { ThemedText } from '@/components/themed-text';
import { Gallery, Spacing } from '@/constants/theme';
import { listVisits } from '@/db/repos/visits';
import { useLocalOwner } from '@/lib/account/owner-store';
import { readPhotoSession, updatePhotoSession } from '@/lib/capture/photo-draft';
import { formatVisitDate } from '@/lib/journal/history';
import { useVenue } from '@/lib/venue/use-venue';

/** Picks the visit for one capture. The choice lives on the draft, so the next scan resolves its own visit again. */
export function CaptureContextScreen() {
  const owner = useLocalOwner();
  const { draftId = '', visitId } = useLocalSearchParams<{ draftId?: string; visitId?: string }>();
  return <CaptureContext key={`${owner}:${draftId}`} owner={owner} draftId={draftId} visitId={visitId} />;
}

function CaptureContext({ owner, draftId, visitId }: { owner: string; draftId: string; visitId?: string }) {
  const visits = useLiveQuery(listVisits(owner), [owner]);
  const { visit: open } = useVenue();
  const [selected, setSelected] = useState<string>(() => {
    const session = readPhotoSession(owner, draftId);
    return session.visitLocalId === null ? 'none' : session.visitLocalId ?? visitId ?? 'none';
  });
  const [error, setError] = useState<string>();
  const availableVisits = visits.data.filter((visit) => visit.owner === owner);
  const noVisits = !!visits.updatedAt && !visits.error && availableVisits.length === 0;

  function choose(value: string) {
    try {
      updatePhotoSession(owner, draftId, { visitLocalId: value === 'none' ? null : value });
      setSelected(value);
      router.back();
    } catch {
      setError('Couldn’t save this visit choice. Your previous selection is unchanged. Try again.');
    }
  }

  function option(value: string, label: string, detail?: string) {
    const current = selected === value;
    return <Pressable key={value} accessibilityRole="button" accessibilityLabel={detail ? `${label} · ${detail}` : label}
      accessibilityState={{ selected: current }} onPress={() => choose(value)}
      style={({ pressed }) => [styles.option, current ? styles.selected : styles.unselected, pressed && styles.pressed]}>
      <View style={styles.optionText}>
        <ThemedText style={current && styles.selectedLabel}>{label}</ThemedText>
        {detail && <ThemedText type="small" themeColor="textSecondary">{detail}</ThemedText>}
        {current && <ThemedText type="smallBold">Selected</ThemedText>}
      </View>
    </Pressable>;
  }

  return <ScrollView style={styles.screen} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
    <Stack.Screen options={{ title: 'Save this artwork to…' }} />
    <ThemedText themeColor="textSecondary">Only this artwork changes. The next scan joins the visit you are at.</ThemedText>
    {error && <ThemedText themeColor="error" accessibilityRole="alert">{error}</ThemedText>}
    <View>{option('none', 'No visit · Save artwork only')}</View>
    {!noVisits && <>
      <GalleryButton label="Create a visit" icon="plus" onPress={() => router.push('/visit-create')} />
      <ThemedText type="subtitle">Your visits</ThemedText>
    </>}
    {visits.error ? <ThemedText themeColor="error" accessibilityRole="alert">Couldn’t load your visits. Close this screen and reopen it to try again.</ThemedText>
      : !visits.updatedAt ? <ListSkeleton label="Loading visits…" rows={3} />
      : noVisits && <EmptyState compact title="No visits yet." detail="Create a visit to remember where you saw this artwork. You can also save it on its own."><GalleryButton label="Create a visit" icon="plus" onPress={() => router.push('/visit-create')} /></EmptyState>}
    <View>{availableVisits.map((visit) => option(visit.localId, visit.venueName, open?.localId === visit.localId ? 'Visiting now' : formatVisitDate(visit.visitedOn)))}</View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Gallery.paper },
  content: { padding: Spacing.content, gap: Spacing.four },
  option: { minHeight: 44, flexDirection: 'row', alignItems: 'center', padding: Spacing.three, gap: Spacing.two },
  unselected: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Gallery.separator },
  optionText: { flex: 1, gap: Spacing.one },
  selected: { backgroundColor: Gallery.highlight, borderWidth: 1, borderColor: Gallery.ink },
  selectedLabel: { fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
