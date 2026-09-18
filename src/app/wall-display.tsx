import { useLocalSearchParams } from 'expo-router';
import { WallDisplayScreen } from '@/components/collection/wall-display-screen';

export default function WallDisplayRoute() {
  const { savedId } = useLocalSearchParams<{ savedId: string }>();
  return <WallDisplayScreen savedId={savedId} />;
}
