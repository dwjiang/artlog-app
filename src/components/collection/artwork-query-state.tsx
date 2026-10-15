import { useRouter } from "expo-router";

import { ArtworkSkeleton } from "@/components/loading-skeleton";
import { SocialState, StateScreen } from "@/components/social/social-state";

export function ArtworkQueryState({
  item,
  loading,
  error,
  onRetry,
}: {
  item: "Artwork" | "Photo";
  loading: boolean;
  error?: Error;
  onRetry: () => void;
}) {
  const router = useRouter();
  return (
    <StateScreen>
      {loading && !error ? (
        <ArtworkSkeleton label={`Opening ${item.toLowerCase()}…`} />
      ) : (
        <SocialState
          title={error ? `Couldn’t load this ${item.toLowerCase()}.` : `${item} unavailable.`}
          detail={
            error
              ? "Your saved collection is still on this iPhone. Try opening this item again."
              : `This ${item.toLowerCase()} may have been removed or belongs to another account.`
          }
          action={error ? "Try again" : "Go back"}
          onAction={error ? onRetry : () => router.back()}
        />
      )}
    </StateScreen>
  );
}
