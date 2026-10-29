import { StyleSheet, View } from "react-native";

import { EmptyState } from "@/components/empty-state";
import { ImageSkeleton } from "@/components/loading-skeleton";
import { MotionPressable } from "@/components/motion-pressable";
import { SafeAreaScrollView } from "@/components/safe-area-scroll";
import { StateScreen } from "@/components/social/social-state";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing, Typography } from "@/constants/theme";
import { useScrollTitle } from "@/hooks/use-scroll-title";
import { useMuseumImage, type MuseumImage } from "@/lib/explore/museum-image";
import { museumExhibitions } from "@/lib/explore/museum-summary";
import type { ExploreMuseum } from "@/lib/explore/types";
import { museumById, useMuseum } from "@/lib/explore/use-explore";
import { useWantToSeeMuseums } from "@/lib/explore/want-to-see";
import { reportError } from "@/lib/observability";
import { useSafeAreaWidth } from "@/lib/ui/safe-area";
import { showErrorToast } from "@/lib/ui/toast";
import { LOOK_AROUND_STILL_ASPECT } from "@/lib/venue/look-around-still";
import { photoCredit } from "@/lib/venue/use-museum-photo";

import { getLookAround, isExpectedLookAroundError } from "../../../modules/look-around/src";
import { DetailActions, LocationPreview, openSourcePage } from "./detail-parts";
import { ExhibitionRow } from "./exhibition-row";
import { HeaderPhoto } from "./explore-image";
import { ExploreState } from "./explore-state";

export function MuseumScreen({ museumId }: { museumId: string }) {
  const explore = useMuseum(museumId);
  const wantToSee = useWantToSeeMuseums();
  const { data } = explore;
  const museum = data && museumById(data, museumId);
  const { scrollRef, headingRef, measureHeading, onScroll } = useScrollTitle(museum?.name ?? "");
  const { image, loading } = useMuseumImage(data, museum, "page");
  if (!data) return <ExploreState view={explore} />;
  if (!museum) {
    return (
      <StateScreen>
        <EmptyState title="This museum isn’t listed." />
      </StateScreen>
    );
  }
  const shows = museumExhibitions(data, museum);
  const facts = [
    { label: "City", value: museum.city },
    { label: "Distance", value: museum.distance },
  ].filter((fact): fact is { label: string; value: string } => Boolean(fact.value));
  return (
    <SafeAreaScrollView
      ref={scrollRef}
      style={styles.root}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      onContentSizeChange={measureHeading}
      onScroll={onScroll}
      scrollEventThrottle={16}
    >
      {loading && <ImageSkeleton label="Loading photo" style={styles.pendingImage} />}
      {/* A show's artwork already appears in its row below, so only the museum's own picture heads the page. */}
      {image && image.source.kind !== "exhibition" && <HeaderImage museum={museum} image={image} />}
      <View style={styles.details}>
        <Text variant="display" accessibilityRole="header" ref={headingRef} onLayout={measureHeading} selectable>
          {museum.name}
        </Text>
        {facts.length > 0 && (
          <View style={styles.facts}>
            {facts.map((fact, index) => (
              <View
                key={fact.label}
                accessible
                accessibilityLabel={`${fact.label}, ${fact.value}`}
                style={[styles.fact, index === 0 ? styles.firstFact : styles.factDivider]}
              >
                <Text style={styles.factLabel}>{fact.label}</Text>
                <Text style={styles.factValue}>{fact.value}</Text>
              </View>
            ))}
          </View>
        )}
        <DetailActions
          saved={wantToSee.saved.has(museum.id)}
          ready={wantToSee.ready}
          onToggle={() => wantToSee.toggle(museum)}
          museum={museum}
        />
      </View>
      <View style={styles.location}>
        <Text variant="section" accessibilityRole="header">
          Location
        </Text>
        <LocationPreview museum={museum} />
      </View>
      <View style={styles.section}>
        <Text variant="section" accessibilityRole="header" style={styles.sectionTitle}>
          Exhibitions
        </Text>
        {shows.length > 0 ? (
          shows.map((exhibition, index) => (
            <ExhibitionRow
              key={exhibition.id}
              exhibition={exhibition}
              today={data.today}
              separator={index < shows.length - 1}
            />
          ))
        ) : (
          <Text style={styles.empty}>No exhibitions listed.</Text>
        )}
      </View>
    </SafeAreaScrollView>
  );
}

function openLookAround(museum: ExploreMuseum) {
  const lookAround = getLookAround();
  if (!lookAround) return;
  lookAround.open(museum.lat, museum.lng).catch((cause: unknown) => {
    if (!isExpectedLookAroundError(cause)) reportError(cause, "explore.look_around.open", { level: "warning" });
    showErrorToast("Couldn’t open Look Around.", () => openLookAround(museum));
  });
}

/** The museum's picture and its credit, which links to the photo's page or opens Look Around there. */
function HeaderImage({ museum, image }: { museum: ExploreMuseum; image: MuseumImage }) {
  const width = useSafeAreaWidth();
  const { source } = image;
  const credit =
    source.kind === "commons"
      ? {
          text: `Photo: ${photoCredit(source.photo) || "Wikimedia Commons"}`,
          hint: "Opens the photo’s page on Wikimedia Commons",
          open: () => openSourcePage(source.photo.pageUrl, "explore.museum_photo_page"),
        }
      : { text: "Look Around · Apple Maps", hint: "Opens Look Around", open: () => openLookAround(museum) };
  return (
    <MotionPressable
      accessibilityRole={source.kind === "commons" ? "link" : "button"}
      accessibilityLabel={credit.text}
      accessibilityHint={credit.hint}
      onPress={credit.open}
      style={styles.image}
    >
      <HeaderPhoto
        uri={image.uri}
        label={image.label}
        width={width - Spacing.content * 2}
        fallbackAspect={LOOK_AROUND_STILL_ASPECT}
      />
      <Text variant="metadata" themeColor="textSecondary" numberOfLines={2}>
        {credit.text}
      </Text>
    </MotionPressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Gallery.paper },
  image: { marginHorizontal: Spacing.content, gap: Spacing.two },
  pendingImage: {
    marginHorizontal: Spacing.content,
    aspectRatio: LOOK_AROUND_STILL_ASPECT,
    borderRadius: Radius.card,
    overflow: "hidden",
  },
  content: { paddingTop: Spacing.two, paddingBottom: Spacing.five },
  details: { paddingHorizontal: Spacing.content, paddingTop: Spacing.three, gap: Spacing.three },
  facts: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: Gallery.separator,
    paddingVertical: Spacing.compact,
  },
  fact: { flex: 1, gap: 2, paddingHorizontal: Spacing.compact },
  firstFact: { paddingLeft: 0 },
  factDivider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: Gallery.separator },
  factLabel: { ...Typography.metadata, color: Gallery.muted },
  factValue: { fontSize: 15, lineHeight: 20, fontWeight: "600", color: Gallery.ink },
  location: { paddingTop: Spacing.four, paddingHorizontal: Spacing.content, gap: Spacing.compact },
  section: { paddingTop: Spacing.four, gap: Spacing.one },
  sectionTitle: { paddingHorizontal: Spacing.content },
  empty: { ...Typography.secondary, color: Gallery.muted, paddingHorizontal: Spacing.content },
});
