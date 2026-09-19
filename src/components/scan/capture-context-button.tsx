import { useFocusEffect, router } from 'expo-router';
import { useCallback, useState } from 'react';
import { getSetting } from '@/db/repos/settings';
import { getVisit } from '@/db/repos/visits';
import { useLocalOwner } from '@/lib/account/owner-store';
import { captureVisitKey } from '@/lib/capture/visit-context';
import { readPhotoSession } from '@/lib/capture/photo-draft';
import { formatVisitDate } from '@/lib/journal/history';
import { Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { ThemedText } from '../themed-text';
import { Gallery } from '@/constants/theme';
export function CaptureContextButton({ draftId, visitId, disabled }: { draftId?: string; visitId?: string; disabled?: boolean }) {
  const owner = useLocalOwner(), [label, setLabel] = useState('Current visit · Change');
  useFocusEffect(useCallback(() => {
    let active = true;
    async function load() {
      const stored = draftId ? readPhotoSession(owner, draftId).visitLocalId : undefined;
      const id = draftId ? stored === undefined ? visitId ?? 'none' : stored ?? 'none' : await getSetting(captureVisitKey(owner));
      const visit = id && !['auto', 'none'].includes(id) ? await getVisit(id, owner) : undefined;
      if (active) setLabel(visit ? `${visit.venueName} · ${formatVisitDate(visit.visitedOn)} · Change` : id === 'none' ? 'No visit · Change' : id && id !== 'auto' ? 'Visit unavailable · Change' : 'Current visit · Change');
    }
    void load().catch(() => { if (active) setLabel('Visit unavailable · Change'); });
    return () => { active = false; };
  }, [owner, draftId, visitId]));
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled}
    onPress={() => router.push({ pathname: '/capture-context', params: { draftId, visitId } })}
    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: Gallery.separator, paddingVertical: 8 }}>
    <Image source="sf:mappin.and.ellipse" tintColor={Gallery.ink} style={{ width: 18, height: 18 }} />
    <View style={{ flex: 1 }}><ThemedText variant="secondary" numberOfLines={2}>{label.replace(/ · Change$/, '')}</ThemedText></View>
    <Image source="sf:chevron.right" tintColor={Gallery.muted} style={{ width: 12, height: 12 }} />
  </Pressable>;
}
