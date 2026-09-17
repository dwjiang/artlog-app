import { useLocalSearchParams } from 'expo-router';

import { SavedWorkScreen } from '@/components/collection/saved-work-screen';

export default function SavedWorkRoute() {
  const { savedId, visitId, photoId } = useLocalSearchParams<{ savedId: string; visitId?: string; photoId?: string }>();
  return <SavedWorkScreen savedId={savedId} visitId={visitId} photoId={photoId} />;
}
