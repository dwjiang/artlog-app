import { useLocalSearchParams } from 'expo-router';
import { ArtworkScreen } from '@/components/social/artwork-screen';
import { SheetToolbar } from '@/components/social/sheet-toolbar';

export default function ArtworkRoute() {
  const { kind, itemId, postId } = useLocalSearchParams<{ kind: string; itemId: string; postId?: string }>();
  return <><ArtworkScreen kind={kind} itemId={itemId} postId={postId} /><SheetToolbar /></>;
}
