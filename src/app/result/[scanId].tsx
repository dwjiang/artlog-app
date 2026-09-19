import { GalleryBackToolbar } from '@/components/gallery-back-toolbar';
import { useLocalSearchParams } from 'expo-router';

import { ResultScreen } from '@/components/scan/result-screen';

export default function ResultRoute() {
  const { scanId } = useLocalSearchParams<{ scanId: string }>();
  return <><GalleryBackToolbar /><ResultScreen scanId={scanId} /></>;
}
