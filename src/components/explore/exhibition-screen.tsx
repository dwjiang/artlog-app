import { StyleSheet, View } from "react-native";

import { EmptyState } from "@/components/empty-state";
import { MotionPressable } from "@/components/motion-pressable";
import { SafeAreaScrollView } from "@/components/safe-area-scroll";
import { StateScreen } from "@/components/social/social-state";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Spacing } from "@/constants/theme";
import { useScrollTitle } from "@/hooks/use-scroll-title";
import { exhibitionDates, exhibitionStatus, friendNames } from "@/lib/explore/exhibition-timing";
import { exhibitionById, museumById, useExhibitions } from "@/lib/explore/use-explore";
import { useWantToSee } from "@/lib/explore/want-to-see";
import { useSafeAreaWidth } from "@/lib/ui/safe-area";

import { DetailActions, FactRow, LocationPreview, openSourcePage, StatusChip } from "./detail-parts";
import { HeaderPhoto, LINK_PREVIEW_ASPECT } from "./explore-image";
import { openMuseum } from "./explore-routes";
import { ExploreState } from "./explore-state";
import { FriendStack } from "./friend-stack";

export function ExhibitionScreen({ exhibitionId }: { exhibitionId: string }) {
  const explore = useExhibitions([exhibitionId]);
  const wantToSee = useWantToSee();
  const width = useSafeAreaWidth();
  const { data } = explore;
  const exhibition = data && exhibitionById(data, exhibitionId);
  const museum = data && exhibition && museumById(data, exhibition.museumId);
  const { scrollRef, headingRef, measureHeading, onScroll } = useScrollTitle(exhibition?.title ?? "");
  if (!data) return <ExploreState view={explore} />;
  if (!exhibition) {
    return (
      <StateScreen>
        <EmptyState title="This exhibition isn’t listed." />
      </StateScreen>
    );
  }
  const status = exhibitionStatus(exhibition, data.today);
  const saved = wantToSee.saved.has(exhibition.id);
  const { image } = exhibition;
  const host = new URL(exhibition.sourceUrl).hostname.replace(/^www\./, "");
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
      {image && (
        // Credits the page the image came from; the image file itself is often on a CDN with an opaque host.
        <MotionPressable
          accessibilityRole="link"
          accessibilityLabel={`Image from ${host}`}
          accessibilityHint="Opens the exhibition page"
          onPress={() => openSourcePage(exhibition.sourceUrl, "explore.exhibition_page")}
          style={styles.image}
        >
          <HeaderPhoto
            uri={image.uri}
            label={image.label}
            width={width - Spacing.content * 2}
            fallbackAspect={LINK_PREVIEW_ASPECT}
          />
          <Text variant="metadata" themeColor="textSecondary">{`Image from ${host}`}</Text>
        </MotionPressable>
      )}
      <View style={styles.details}>
        <View style={styles.heading}>
          <StatusChip status={status} />
          <Text variant="display" accessibilityRole="header" ref={headingRef} onLayout={measureHeading} selectable>
            {exhibition.title}
          </Text>
          {museum && (
            <MotionPressable
              accessibilityRole="button"
              accessibilityHint="Opens the museum"
              onPress={() => openMuseum(museum.id)}
              style={styles.museumLink}
            >
              <Text style={styles.museum}>{museum.name}</Text>
            </MotionPressable>
          )}
        </View>
        <DetailActions
          saved={saved}
          ready={wantToSee.ready}
          onToggle={() => wantToSee.toggle(exhibition)}
          museum={museum}
        />
        {exhibition.friends.length > 0 && (
          <View style={styles.section}>
            <Text variant="section" accessibilityRole="header">
              Friends
            </Text>
            <View accessible accessibilityLabel={`${friendNames(exhibition.friends)} want to see it`}>
              <FriendStack friends={exhibition.friends} size={30} suffix="want to see it" />
            </View>
          </View>
        )}
        <View>
          <FactRow icon="calendar">{exhibitionDates(exhibition)}</FactRow>
          <FactRow icon="safari" last onPress={() => openSourcePage(exhibition.sourceUrl, "explore.exhibition_page")}>
            {`Details on ${host}`}
          </FactRow>
        </View>
        {museum && (
          <View style={styles.location}>
            <LocationPreview museum={museum} />
            <Text variant="secondary" themeColor="textSecondary">
              {museum.distance ? `${museum.name} · ${museum.distance} away` : museum.name}
            </Text>
          </View>
        )}
      </View>
    </SafeAreaScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Gallery.paper },
  content: { paddingTop: Spacing.two, paddingBottom: Spacing.five },
  image: { marginHorizontal: Spacing.content, gap: Spacing.two },
  details: { paddingHorizontal: Spacing.content, paddingTop: Spacing.three, gap: Spacing.four },
  heading: { gap: Spacing.two },
  museumLink: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", marginVertical: -Spacing.two },
  museum: { fontSize: 17, lineHeight: 22, color: Gallery.accent },
  section: { gap: Spacing.compact },
  location: { gap: Spacing.two },
});
