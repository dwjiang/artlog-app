import { useLocalSearchParams } from 'expo-router';

import { LabelCaptureScreen } from '@/components/scan/label-capture-screen';

export default function LabelCaptureRoute() {
  const { scanId } = useLocalSearchParams<{ scanId: string }>();
  return <LabelCaptureScreen scanId={scanId} />;
}
