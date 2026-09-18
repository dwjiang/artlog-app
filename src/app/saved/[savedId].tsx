import { useLocalSearchParams } from 'expo-router';

import { SavedWorkScreen } from '@/components/collection/saved-work-screen';
import { SavedWorkToolbar } from '@/components/collection/saved-work-toolbar';

export default function SavedWorkRoute() {
  const { savedId, visitId, photoId } = useLocalSearchParams<{ savedId: string; visitId?: string; photoId?: string }>();
  return <>
    <SavedWorkScreen savedId={savedId} visitId={visitId} photoId={photoId} />
    <SavedWorkToolbar savedId={savedId} visitId={visitId} />
  </>;
}
