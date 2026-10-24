import { useState, type ComponentRef, type Ref } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";

import { ArtworkFrame, useArtworkFrameHeight } from "@/components/artwork/artwork-frame";
import { ArtworkIdentity } from "@/components/artwork/artwork-identity";
import { ArtworkStory } from "@/components/artwork/artwork-story";
import { DisplayMedia } from "@/components/artwork/display-media";
import { PhotoGallery } from "@/components/artwork/photo-gallery";
import { ThemedText as Text } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import type { SharedArtwork } from "@/lib/social/types";
import { useArtworkResearch } from "@/lib/use-artwork-research";

/** Someone else's shared artwork, laid out like a scan's result card. */
export function PublishedArtwork({
  artwork,
  photos,
  token,
  enrichment,
  headingRef,
  onHeadingLayout,
}: {
  artwork: SharedArtwork["artwork"];
  photos: SharedArtwork["artwork"]["media"][];
  token?: string | null;
  enrichment?: SharedArtwork["enrichment"];
  headingRef?: Ref<ComponentRef<typeof Text>>;
  onHeadingLayout?: () => void;
}) {
  const { width } = useWindowDimensions();
  return (
    <View style={styles.page}>
      <PublishedArtworkGallery
        key={`${width}:${JSON.stringify(photos)}`}
        title={artwork.title}
        photos={photos}
        token={token}
      />
      <ArtworkIdentity
        title={artwork.title}
        artist={artwork.artist}
        date={artwork.date}
        medium={artwork.medium}
        institution={artwork.institution}
        headingRef={headingRef}
        onHeadingLayout={onHeadingLayout}
      />
      {enrichment && <PublishedStory artwork={artwork} story={enrichment} />}
      {artwork.media.kind !== "placeholder" && artwork.media.credit && (
        <Text selectable variant="metadata" themeColor="textSecondary">
          {artwork.media.credit}
        </Text>
      )}
    </View>
  );
}

function PublishedStory({
  artwork,
  story,
}: {
  artwork: SharedArtwork["artwork"];
  story: NonNullable<SharedArtwork["enrichment"]>;
}) {
  const research = useArtworkResearch(story.artworkId);
  return (
    <ArtworkStory
      artworkId={story.artworkId}
      title={artwork.title}
      artist={artwork.artist}
      date={artwork.date}
      docent={story.docent}
      factSheet={story.factSheet}
      status={research.status}
      onRetry={research.retry}
      waitWhileWriting
      report={{ kind: "docent", artworkId: story.artworkId }}
    />
  );
}

function PublishedArtworkGallery({
  title,
  photos,
  token,
}: {
  title: string;
  photos: SharedArtwork["artwork"]["media"][];
  token?: string | null;
}) {
  const [page, setPage] = useState(0);
  const maxImageHeight = useArtworkFrameHeight();
  if (photos.length === 0) {
    return <ArtworkFrame accessibilityLabel={title} unavailableText="No photos shared for this artwork." />;
  }
  return (
    <View style={styles.gallery}>
      <PhotoGallery
        photos={photos.map((media, index) => ({
          media,
          id: String(index),
          label: `photo ${index + 1}`,
          width: media.width,
          height: media.height,
        }))}
        page={page}
        onPageChange={setPage}
        maxImageHeight={maxImageHeight}
        renderPhoto={({ media }, index, size) => (
          <DisplayMedia
            media={media}
            label={`${title}, photo ${index + 1}`}
            width={size.width}
            height={size.height}
            token={token}
          />
        )}
        renderThumbnail={({ media }, index) => (
          <DisplayMedia
            media={media}
            label={`${title}, thumbnail ${index + 1}`}
            width={36}
            height={44}
            token={token}
            feedSize
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: Spacing.content,
    paddingTop: Spacing.two,
    gap: Spacing.three,
  },
  // The gallery pages span the safe area and pad each photo back to the content edge.
  gallery: { marginHorizontal: -Spacing.content },
});
