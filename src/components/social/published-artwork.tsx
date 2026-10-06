import { useState, type ComponentRef, type Ref } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";

import { DisplayMedia } from "@/components/artwork/display-media";
import { PhotoGallery } from "@/components/artwork/photo-gallery";
import { NoteHeading } from "@/components/collection/note-editor";
import { EmptySymbol } from "@/components/empty-state";
import { DocentSection, type DocentSectionProps } from "@/components/scan/result/docent-section";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Typography } from "@/constants/theme";
import type { SharedArtwork } from "@/lib/social/types";

import { socialStyles } from "./social-styles";
import { TaggedText } from "./tagged-text";

export function PublishedArtwork({
  artwork,
  photos,
  token,
  note,
  enrichment,
  headingRef,
  onHeadingLayout,
}: {
  artwork: SharedArtwork["artwork"];
  photos: SharedArtwork["artwork"]["media"][];
  token?: string | null;
  note?: string;
  enrichment?: DocentSectionProps;
  headingRef?: Ref<ComponentRef<typeof Text>>;
  onHeadingLayout?: () => void;
}) {
  const { width } = useWindowDimensions();
  return (
    <>
      <PublishedArtworkGallery
        key={`${width}:${JSON.stringify(photos)}`}
        title={artwork.title}
        photos={photos}
        token={token}
      />
      <View style={styles.details}>
        <View style={styles.museumLabel}>
          <Text selectable accessibilityRole="header" style={styles.artist} ref={headingRef} onLayout={onHeadingLayout}>
            {artwork.title}
          </Text>
          <Text selectable style={styles.title}>
            {artwork.artist || "Artist unknown"}
            {artwork.date ? `, ${artwork.date}` : ""}
          </Text>
          {!!artwork.medium && (
            <Text selectable style={styles.medium}>
              {artwork.medium}
            </Text>
          )}
        </View>
        {!!note && (
          <>
            <View style={styles.divider} />
            <View style={{ gap: 8 }}>
              <NoteHeading title="Notes" />
              <TaggedText selectable style={styles.note}>
                {note}
              </TaggedText>
            </View>
          </>
        )}
        {enrichment && (
          <>
            <View style={styles.divider} />
            <DocentSection docent={enrichment.docent} factSheet={enrichment.factSheet} title="About this work" />
          </>
        )}
        {artwork.media.kind !== "placeholder" && artwork.media.credit && (
          <>
            <View style={styles.divider} />
            <Text selectable style={styles.caption}>
              {artwork.media.credit}
            </Text>
          </>
        )}
      </View>
    </>
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
  if (photos.length === 0) {
    return (
      <View style={styles.emptyGallery}>
        <EmptySymbol name="photo" />
        <Text style={styles.caption}>No photos shared for this artwork.</Text>
      </View>
    );
  }
  return (
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
        <DisplayMedia media={media} label={`${title}, thumbnail ${index + 1}`} width={36} height={44} token={token} />
      )}
    />
  );
}

const styles = StyleSheet.create({
  details: { padding: 20, gap: 16 },
  museumLabel: { gap: 4 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Gallery.separator,
  },
  artist: { ...Typography.display, color: Gallery.ink },
  title: { color: Gallery.ink, fontSize: 20, lineHeight: 26 },
  medium: { color: Gallery.muted, fontSize: 15, lineHeight: 22 },
  note: {
    ...socialStyles.body,
    textAlign: "left",
    color: Gallery.ink,
    marginLeft: 24,
  },
  caption: { color: Gallery.muted, fontSize: 13, lineHeight: 18 },
  emptyGallery: {
    gap: 12,
    minHeight: 180,
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Gallery.fill,
  },
});
