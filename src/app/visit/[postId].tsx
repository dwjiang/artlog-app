import { useLocalSearchParams } from 'expo-router';
import { VisitScreen } from '@/components/social/visit-screen';

export default function VisitRoute() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  return <VisitScreen postId={postId} />;
}
