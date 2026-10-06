import { useMutation } from "convex/react";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet } from "react-native";

import { ArtworkFrame } from "@/components/artwork/artwork-frame";
import { ArtworkIdentity } from "@/components/artwork/artwork-identity";
import { ArtworkStory } from "@/components/artwork/artwork-story";
import { ArtworkSkeleton } from "@/components/loading-skeleton";
import { SocialState } from "@/components/social/social-state";
import { Gallery, Spacing } from "@/constants/theme";
import { pageSizedImage } from "@/lib/catalog/catalog-image";
import { useCatalogReady } from "@/lib/catalog/use-catalog-ready";
import { isNetworkError } from "@/lib/network-error";
import { reportError } from "@/lib/observability";
import { useSocialQuery } from "@/lib/social/use-social-query";
import { useArtworkEnrichment } from "@/lib/use-artwork-enrichment";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

/** A catalog work opened from search, laid out like a scan's result card. */
export function CatalogArtworkScreen({ artworkId }: { artworkId: Id<"artworks"> }) {
  const router = useRouter();
  const catalog = useCatalogReady();
  const artwork = useSocialQuery(api.artworks.get, catalog.ready ? { artworkId } : "skip", catalog.scope);
  const enrichment = useArtworkEnrichment(artworkId);
  const story = enrichment instanceof Error ? undefined : enrichment;
  const requestedGeneration = useResearch(
    artworkId,
    !!story && !story.docent?.length && !story.docentWriting,
    story?.docentGeneration,
  );
  // Claiming advances the generation even if the client misses the whole run while disconnected.
  const writing =
    !!story?.docentWriting || (requestedGeneration !== undefined && story?.docentGeneration === requestedGeneration);

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
      <ScrollView style={styles.page} contentInsetAdjustmentBehavior="automatic">
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
        status={writing ? "writing" : undefined}
        report={{ kind: "docent", artworkId }}
      />
    </ScrollView>
  );
}

/** Asks once per visit to the page for research the work has never had. */
function useResearch(artworkId: Id<"artworks">, needed: boolean, generation: number | undefined) {
  const start = useMutation(api.artworks.research);
  const asked = useRef(false);
  const [requestedGeneration, setRequestedGeneration] = useState<number>();
  useEffect(() => {
    if (!needed || generation === undefined || asked.current) return;
    asked.current = true;
    start({ artworkId })
      .then((started) => {
        if (started) setRequestedGeneration(generation);
      })
      .catch((cause) => {
        if (!isNetworkError(cause)) reportError(cause, "catalog.research");
      });
  }, [artworkId, needed, generation, start]);
  return requestedGeneration;
}

function State(props: Parameters<typeof SocialState>[0]) {
  return (
    <ScrollView style={styles.page} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.centered}>
      <SocialState {...props} />
    </ScrollView>
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
  centered: { flexGrow: 1, justifyContent: "center" },
});
