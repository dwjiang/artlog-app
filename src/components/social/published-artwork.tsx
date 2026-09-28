import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";

import { DisplayMedia } from "@/components/artwork/display-media";
import { NoteHeading } from "@/components/collection/note-editor";
import { WallFrame, wallFrameInset } from "@/components/collection/wall-frame";
import { EmptySymbol } from "@/components/empty-state";
import { DocentSection, type DocentSectionProps } from "@/components/scan/result/docent-section";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Typography } from "@/constants/theme";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import type { SharedArtwork } from "@/lib/social/types";
import type { WallFrame as Frame } from "@/lib/wall/wall-layout";

import { socialStyles } from "./social-styles";

export function PublishedArtwork({
  artwork,
  photos,
  frame = "none",
  token,
  note,
  enrichment,
}: {
  artwork: SharedArtwork["artwork"];
  photos: SharedArtwork["artwork"]["media"][];
  frame?: Frame;
  token?: string | null;
  note?: string;
  enrichment?: DocentSectionProps;
}) {
  const { width } = useWindowDimensions();
  return (
    <>
      <PublishedArtworkGallery
        key={`${width}:${JSON.stringify(photos)}`}
        title={artwork.title}
        photos={photos}
        frame={frame}
        width={width}
        token={token}
      />
      <View style={styles.details}>
        <View style={styles.museumLabel}>
          <Text selectable accessibilityRole="header" style={styles.artist}>
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
              <Text selectable style={styles.note}>
                {note}
              </Text>
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
  frame,
  width,
  token,
}: {
  title: string;
  photos: SharedArtwork["artwork"]["media"][];
  frame: Frame;
  width: number;
  token?: string | null;
}) {
  const gallery = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const reduceMotion = useReducedMotion();
  const goTo = (index: number) => {
    const next = Math.max(0, Math.min(photos.length - 1, index));
    setPage(next);
    gallery.current?.scrollTo({ x: next * width, animated: !reduceMotion });
  };
  if (photos.length === 0) {
    return (
      <View style={styles.emptyGallery}>
        <EmptySymbol name="photo" />
        <Text style={styles.caption}>No photos shared for this artwork.</Text>
      </View>
    );
  }
  return (
    <View>
      <ScrollView
        ref={gallery}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        accessibilityLabel="Artwork photos"
        onMomentumScrollEnd={({ nativeEvent }) =>
          setPage(Math.max(0, Math.min(photos.length - 1, Math.round(nativeEvent.contentOffset.x / width))))
        }
      >
        {photos.map((media, index) => {
          const outerWidth = Math.max(1, width - 40);
          return (
            <View key={index} style={[styles.slide, { width }]}>
              <WallFrame frame={frame} width={outerWidth}>
                <DisplayMedia
                  media={media}
                  label={`${title}, photo ${index + 1}`}
                  width={Math.max(1, outerWidth - wallFrameInset(frame, outerWidth) * 2)}
                  token={token}
                />
              </WallFrame>
            </View>
          );
        })}
      </ScrollView>
      {photos.length > 1 && (
        <View style={styles.galleryFooter}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous photo"
            disabled={page === 0}
            onPress={() => goTo(page - 1)}
            style={[styles.arrow, page === 0 && { opacity: 0.4 }]}
          >
            <Text style={styles.arrowText}>‹</Text>
          </Pressable>
          <Text accessibilityLiveRegion="polite" style={[styles.caption, { fontVariant: ["tabular-nums"] }]}>
            {page + 1} / {photos.length}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next photo"
            disabled={page >= photos.length - 1}
            onPress={() => goTo(page + 1)}
            style={[styles.arrow, page >= photos.length - 1 && { opacity: 0.4 }]}
          >
            <Text style={styles.arrowText}>›</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  slide: {
    paddingTop: 8,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  galleryFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
    paddingHorizontal: 20,
  },
  arrow: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  arrowText: { fontSize: 24, color: Gallery.ink },
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
