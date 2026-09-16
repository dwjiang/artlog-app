import { useFocusEffect, router } from 'expo-router';
import { useCallback, useState } from 'react';
import { getSetting } from '@/db/repos/settings';
import { getVisit } from '@/db/repos/visits';
import { useLocalOwner } from '@/lib/account/owner-store';
import { captureVisitKey } from '@/lib/capture/visit-context';
import { formatVisitDate } from '@/lib/journal/history';
import { GalleryButton } from '../collection/gallery-button';
export function CaptureContextButton() {
  const owner = useLocalOwner(), [label, setLabel] = useState('Current visit · Change');
  useFocusEffect(useCallback(() => {
    let active = true;
    void getSetting(captureVisitKey(owner)).then(async (id) => {
      const visit = id && !['auto', 'none'].includes(id) ? await getVisit(id, owner) : undefined;
      if (active) setLabel(visit ? `${visit.venueName} · ${formatVisitDate(visit.visitedOn)}` : id === 'none' ? 'No visit · Change' : 'Current visit · Change');
    });
    return () => { active = false; };
  }, [owner]));
  return <GalleryButton label={label} icon="calendar" onPress={() => router.push('/capture-context')} />;
}
