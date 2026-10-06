import { useState } from "react";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { EmptyState } from "@/components/empty-state";
import { LoadingImage } from "@/components/loading-image";
import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Spacing } from "@/constants/theme";
import { useScrollTitle } from "@/hooks/use-scroll-title";
import { exhibitionStatus, friendNames, shortDate } from "@/lib/explore/exhibition-timing";
import { toggleReminder, toggleWantToSee, usePlans } from "@/lib/explore/plans";
import { exhibitionById, museumById, useExplore } from "@/lib/explore/use-explore";

import { FactRow, openDirections, StatusChip } from "./detail-parts";
import { openMuseum } from "./explore-routes";
import { FriendStack } from "./friend-stack";

// The filled button's own height, so an outlined neighbor lines up with it.
const BUTTON_HEIGHT = 52;

export function ExhibitionScreen({ exhibitionId }: { exhibitionId: string }) {
  const data = useExplore();
  const plans = usePlans();
  const { width } = useWindowDimensions();
  const [aspect, setAspect] = useState(1);
  const exhibition = exhibitionById(data, exhibitionId);
  const museum = exhibition && museumById(data, exhibition.museumId);
  const { scrollRef, headingRef, measureHeading, onScroll } = useScrollTitle(exhibition?.title ?? "");
  if (!exhibition) {
    return (
      <ScrollView style={styles.root} contentInsetAdjustmentBehavior="automatic">
        <EmptyState title="This exhibition isn’t listed." />
      </ScrollView>
    );
  }
  const status = exhibitionStatus(exhibition, data.today);
  const saved = plans.wantToSee.has(exhibition.id);
  const reminded = plans.reminders.has(exhibition.id);
  const imageWidth = width - Spacing.content * 2;
  const year = exhibition.endsOn.slice(0, 4);
  return (
    <ScrollView
      ref={scrollRef}
      style={styles.root}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      onContentSizeChange={measureHeading}
      onScroll={onScroll}
      scrollEventThrottle={16}
    >
      <LoadingImage
        uri={exhibition.image.uri}
        label={exhibition.image.label}
        contentFit="contain"
        onLoad={({ source }) => setAspect(source.width / source.height)}
        style={{ width: imageWidth, height: imageWidth / aspect, marginHorizontal: Spacing.content }}
      />
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
        <View style={styles.actions}>
          <View style={styles.action}>
            <GalleryButton
              label={saved ? "Saved" : "Want to see"}
              accessibilityLabel={saved ? "Remove from Want to see" : "Want to see"}
              icon={saved ? "bookmark.fill" : "bookmark"}
              variant={saved ? "outlined" : "filled"}
              fullWidth
              minHeight={BUTTON_HEIGHT}
              onPress={() => toggleWantToSee(exhibition.id)}
            />
          </View>
          <View style={styles.action}>
            {exhibition.startsOn > data.today ? (
              <GalleryButton
                label={reminded ? "Reminder on" : "Remind me"}
                accessibilityLabel={reminded ? "Turn off the opening-day reminder" : "Remind me when it opens"}
                icon={reminded ? "bell.fill" : "bell"}
                variant="outlined"
                fullWidth
                minHeight={BUTTON_HEIGHT}
                onPress={() => toggleReminder(exhibition.id)}
              />
            ) : (
              museum && (
                <GalleryButton
                  label="Directions"
                  icon="arrow.triangle.turn.up.right.diamond"
                  variant="outlined"
                  fullWidth
                  minHeight={BUTTON_HEIGHT}
                  onPress={() => openDirections(museum)}
                />
              )
            )}
          </View>
        </View>
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
          <FactRow icon="calendar">{`${shortDate(exhibition.startsOn)} – ${shortDate(exhibition.endsOn)}, ${year}`}</FactRow>
          {museum && <FactRow icon="clock">{museum.hoursToday}</FactRow>}
          {museum?.admission && (
            <FactRow icon="ticket" last>
              {museum.admission === "Free" ? "Free admission" : `Admission ${museum.admission}`}
            </FactRow>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Gallery.paper },
  content: { paddingTop: Spacing.two, paddingBottom: Spacing.five },
  details: { paddingHorizontal: Spacing.content, paddingTop: Spacing.three, gap: Spacing.four },
  heading: { gap: Spacing.two },
  museumLink: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", marginVertical: -Spacing.two },
  museum: { fontSize: 17, lineHeight: 22, color: Gallery.accent },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.compact },
  action: { flexGrow: 1, flexBasis: 140 },
  section: { gap: Spacing.compact },
});
