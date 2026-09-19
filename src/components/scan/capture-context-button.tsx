import { useFocusEffect, router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { calendarDate } from '../../../shared/journal/limits';
import { getVisit } from '@/db/repos/visits';
import type { Visit } from '@/db/schema';
import { useLocalOwner } from '@/lib/account/owner-store';
import { readPhotoSession } from '@/lib/capture/photo-draft';
import { formatVisitDate } from '@/lib/journal/history';
import { Gallery, Radius, Spacing } from '@/constants/theme';
import { ThemedText } from '../themed-text';

export function captureVisitLabel(visit: Pick<Visit, 'venueName' | 'visitedOn' | 'timeZone'>, now = Date.now()): string {
  return `${visit.venueName} · ${visit.visitedOn === calendarDate(now, visit.timeZone) ? 'Today' : formatVisitDate(visit.visitedOn)}`;
}

/** The visit this capture will save to: the capture's own unless the draft overrides it. Tapping picks another for this shot only. */
export function CaptureContextButton({ draftId, visitId, disabled }: { draftId: string; visitId?: string; disabled?: boolean }) {
  const owner = useLocalOwner(), [label, setLabel] = useState('Loading visit…');
  useFocusEffect(useCallback(() => {
    let active = true;
    async function load() {
      const stored = readPhotoSession(owner, draftId).visitLocalId;
      const id = stored === undefined ? visitId : stored ?? undefined;
      const visit = id ? await getVisit(id, owner) : undefined;
      if (active) setLabel(visit ? captureVisitLabel(visit) : id ? 'Visit unavailable' : 'No visit');
    }
    void load().catch(() => { if (active) setLabel('Visit unavailable'); });
    return () => { active = false; };
  }, [owner, draftId, visitId]));
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label} · Change`} accessibilityHint="Chooses the visit for this artwork" accessibilityState={{ disabled: !!disabled }} disabled={disabled}
    onPress={() => router.push({ pathname: '/capture-context', params: { draftId, visitId } })}
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
