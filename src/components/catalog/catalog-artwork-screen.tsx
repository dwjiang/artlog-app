import { useRouter } from "expo-router";
import { ScrollView, StyleSheet } from "react-native";

import { ArtworkFrame } from "@/components/artwork/artwork-frame";
import { ArtworkIdentity } from "@/components/artwork/artwork-identity";
import { ArtworkStory } from "@/components/artwork/artwork-story";
import { ArtworkSkeleton } from "@/components/loading-skeleton";
import { SocialState, StateScreen } from "@/components/social/social-state";
import { Gallery, Spacing } from "@/constants/theme";
import { pageSizedImage } from "@/lib/catalog/catalog-image";
import { useCatalogReady } from "@/lib/catalog/use-catalog-ready";
import { reportError } from "@/lib/observability";
import { useSocialQuery } from "@/lib/social/use-social-query";
import { useArtworkEnrichment } from "@/lib/use-artwork-enrichment";
import { useArtworkResearch } from "@/lib/use-artwork-research";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

/** A catalog work opened from search, laid out like a scan's result card. */
export function CatalogArtworkScreen({ artworkId }: { artworkId: Id<"artworks"> }) {
  const router = useRouter();
  const catalog = useCatalogReady();
  const artwork = useSocialQuery(api.artworks.get, catalog.ready ? { artworkId } : "skip", catalog.scope);
  const enrichment = useArtworkEnrichment(artworkId);
  const story = enrichment instanceof Error ? undefined : enrichment;
  const research = useArtworkResearch(artworkId);

  if (!catalog.ready && catalog.offline) {
    return <State title="You’re offline." detail="Connect to open this artwork." icon="wifi.slash" />;
  }
  if (artwork.error) {
    return (
      <State
        title="Couldn’t load this artwork."
        detail="Check your connection and try again."
        action="Try again"
        onAction={artwork.refresh}
      />
    );
  }
  if (artwork.data === null) {
    return (
      <State
        title="Artwork unavailable."
        detail="This artwork is no longer in the catalog."
        action="Go back"
        onAction={() => router.back()}
      />
    );
  }
  const work = artwork.data;
  if (!work) {
    return (
      <ScrollView style={styles.page} contentInsetAdjustmentBehavior="automatic" scrollEnabled={false}>
        <ArtworkSkeleton />
      </ScrollView>
    );
  }
  const { artistId } = work;
  return (
    <ScrollView style={styles.page} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      <ArtworkFrame
        uri={work.thumbnailUrl && pageSizedImage(work.thumbnailUrl)}
        accessibilityLabel={`${work.title} by ${work.artist}`}
        unavailableText="No public-domain image"
        onError={(message) =>
          reportError(new Error(message ?? "Catalog image unavailable"), "catalog.load_image", { level: "warning" })
        }
      />
      <ArtworkIdentity
        title={work.title}
        artist={work.artist}
        date={work.date}
        medium={work.medium}
        institution={work.institution}
        onOpenArtist={
          artistId ? () => router.push({ pathname: "/artist/[artistId]", params: { artistId } }) : undefined
        }
      />
      <ArtworkStory
        artworkId={artworkId}
        title={work.title}
        artist={work.artist}
        date={work.date}
        docent={story?.docent}
        factSheet={story?.factSheet}
        status={research.status}
        onRetry={research.retry}
        waitWhileWriting
        report={{ kind: "docent", artworkId }}
      />
    </ScrollView>
  );
}

function State(props: Parameters<typeof SocialState>[0]) {
  return (
    <StateScreen>
      <SocialState {...props} />
    </StateScreen>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Gallery.paper },
  content: {
    paddingHorizontal: Spacing.content,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
});
