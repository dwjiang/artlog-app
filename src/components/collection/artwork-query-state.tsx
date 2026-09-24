import { useRouter } from "expo-router";
import { ScrollView } from "react-native";

import { ArtworkSkeleton } from "@/components/loading-skeleton";
import { SocialState } from "@/components/social/social-state";
import { Gallery } from "@/constants/theme";

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
    <ScrollView
      style={{ flex: 1, backgroundColor: Gallery.paper }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: loading && !error ? "flex-start" : "center",
      }}
    >
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
    </ScrollView>
  );
}
