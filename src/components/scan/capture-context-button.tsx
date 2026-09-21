import { useFocusEffect, router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import tzLookup from '@photostructure/tz-lookup';
import { calendarDate } from '../../../shared/journal/limits';
import type { Id } from '../../../convex/_generated/dataModel';
import { getVisit } from '@/db/repos/visits';
import type { Visit } from '@/db/schema';
import { useLocalOwner } from '@/lib/account/owner-store';
import { readPhotoSession } from '@/lib/capture/photo-draft';
import { formatVisitDate } from '@/lib/journal/history';
import { captureVisitChoice } from '@/lib/capture/visit-choice';
import { venueMetadataForIds } from '@/lib/venue/venue-db';
import { isVisitToday } from '@/lib/venue/venue-reducer';
import { Gallery, Radius, Spacing } from '@/constants/theme';
import { ThemedText } from '../themed-text';

function dayLabel(visitedOn: string, today: boolean): string {
  return today ? 'Today' : formatVisitDate(visitedOn);
}

export function captureVisitLabel(visit: Pick<Visit, 'venueName' | 'visitedOn' | 'timeZone'>, now = Date.now()): string {
  return `${visit.venueName} · ${dayLabel(visit.visitedOn, isVisitToday(visit, now))}`;
}

/** The museum a save starts or joins a visit at, with the visit's day taken from the capture in the museum's time zone. */
export async function venueVisitLabel(venueId: Id<'museums'>, capturedAt: number, now = Date.now()): Promise<{ name: string; visitedOn: string; today: boolean; day: string } | undefined> {
  const [venue] = await venueMetadataForIds([venueId]);
  if (!venue) return undefined;
  const timeZone = tzLookup(venue.lat, venue.lng);
  const visitedOn = calendarDate(capturedAt, timeZone);
  const today = isVisitToday({ visitedOn, timeZone }, now);
  return { name: venue.name, visitedOn, today, day: dayLabel(visitedOn, today) };
}

export type CaptureContextCapture = { photoPath: string; visitLocalId?: string | null; venueId?: Id<'museums'> | null; capturedAt?: number };

/** The visit this capture will save to: its own, the museum it was scanned at, or the draft's override. Tapping picks another for this shot only. */
export function CaptureContextButton({ capture, disabled }: { capture: CaptureContextCapture; disabled?: boolean }) {
  const owner = useLocalOwner(), [label, setLabel] = useState('Loading visit…');
  const { photoPath: draftId, visitLocalId, venueId, capturedAt } = capture;
  useFocusEffect(useCallback(() => {
    let active = true;
    async function load() {
      const choice = captureVisitChoice({ visitLocalId, venueId, capturedAt }, readPhotoSession(owner, draftId));
      let next = 'No visit';
      if (choice.kind === 'visit') {
        const visit = await getVisit(choice.localId, owner);
        next = visit ? captureVisitLabel(visit) : 'Visit unavailable';
      } else if (choice.kind === 'venue') {
        const venue = await venueVisitLabel(choice.venueId, capturedAt ?? Date.now());
        next = venue ? `${venue.name} · ${venue.day}` : 'Visit unavailable';
      }
      if (active) setLabel(next);
    }
    void load().catch(() => { if (active) setLabel('Visit unavailable'); });
    return () => { active = false; };
  }, [owner, draftId, visitLocalId, venueId, capturedAt]));
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label} · Change`} accessibilityHint="Chooses the visit for this artwork" accessibilityState={{ disabled: !!disabled }} disabled={disabled}
    onPress={() => router.push({ pathname: '/capture-context', params: { draftId, visitId: visitLocalId ?? undefined, venueId: venueId ?? undefined, capturedAt: capturedAt === undefined ? undefined : String(capturedAt) } })}
    style={({ pressed }) => [styles.chip, pressed && styles.pressed, disabled && styles.disabled]}>
    <Image source="sf:mappin.and.ellipse" tintColor={Gallery.ink} style={styles.icon} />
    <ThemedText type="smallBold" numberOfLines={1} style={styles.label}>{label}</ThemedText>
    <Image source="sf:chevron.down" tintColor={Gallery.ink} style={styles.chevron} />
  </Pressable>;
}

const styles = StyleSheet.create({
  chip: { alignSelf: 'flex-start', maxWidth: '100%', minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: Spacing.two,
    paddingVertical: Spacing.one, paddingLeft: Spacing.compact, paddingRight: Spacing.compact, borderRadius: Radius.full, borderWidth: 1, borderColor: Gallery.ink, backgroundColor: Gallery.surface },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.5 },
  icon: { width: 16, height: 16 },
  chevron: { width: 10, height: 10 },
  label: { flexShrink: 1, fontSize: 15, lineHeight: 20 },
});
