import { useLocalSearchParams } from 'expo-router';

import { SavedWorkScreen } from '@/components/collection/saved-work-screen';

export default function SavedWorkRoute() {
  const { savedId } = useLocalSearchParams<{ savedId: string }>();
  return <SavedWorkScreen savedId={savedId} />;
}
