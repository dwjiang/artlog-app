import { useFocusEffect, router } from 'expo-router';
import { useCallback, useState } from 'react';
import { getSetting } from '@/db/repos/settings';
import { getVisit } from '@/db/repos/visits';
import { useLocalOwner } from '@/lib/account/owner-store';
import { captureVisitKey } from '@/lib/capture/visit-context';
import { readPhotoSession } from '@/lib/capture/photo-draft';
import { formatVisitDate } from '@/lib/journal/history';
import { GalleryButton } from '../collection/gallery-button';
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
    void load();
    return () => { active = false; };
  }, [owner, draftId, visitId]));
  return <GalleryButton label={label} icon="calendar" disabled={disabled} onPress={() => router.push({ pathname: '/capture-context', params: { draftId } })} />;
}
