import { useLocalSearchParams } from 'expo-router';

import { SavedWorkScreen } from '@/components/collection/saved-work-screen';

export default function SavedWorkRoute() {
  const { savedId, visitId } = useLocalSearchParams<{ savedId: string; visitId?: string }>();
  return <SavedWorkScreen savedId={savedId} visitId={visitId} />;
}
