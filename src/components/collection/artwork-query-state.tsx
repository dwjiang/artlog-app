import { useRouter } from 'expo-router';
import { ScrollView } from 'react-native';
import { Gallery } from '@/constants/theme';
import { SocialState } from '../social/social-state';

export function ArtworkQueryState({ item, loading, error, onRetry }: {
  item: 'Artwork' | 'Photo'; loading: boolean; error?: Error; onRetry: () => void;
}) {
  const router = useRouter();
  return <ScrollView style={{ flex: 1, backgroundColor: Gallery.paper }} contentInsetAdjustmentBehavior="automatic"
    contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
    <SocialState title={error ? `Couldn’t load this ${item.toLowerCase()}.` : loading ? `Opening ${item.toLowerCase()}…` : `${item} unavailable.`}
      detail={error ? 'Your saved collection is still on this iPhone. Try opening this item again.' : loading ? undefined : `This ${item.toLowerCase()} may have been removed or belongs to another account.`}
      loading={!error && loading} action={error ? 'Try again' : loading ? undefined : 'Go back'}
      onAction={error ? onRetry : () => router.back()} />
  </ScrollView>;
}
