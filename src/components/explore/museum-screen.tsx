import { Image } from "expo-image";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { EmptyState } from "@/components/empty-state";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing, Typography } from "@/constants/theme";
import { useScrollTitle } from "@/hooks/use-scroll-title";
import { museumExhibitions } from "@/lib/explore/museum-summary";
import { museumById, useExplore } from "@/lib/explore/use-explore";

import { openDirections } from "./detail-parts";
import { ExhibitionRow } from "./exhibition-row";

export function MuseumScreen({ museumId }: { museumId: string }) {
  const data = useExplore();
  const { width } = useWindowDimensions();
  const museum = museumById(data, museumId);
  const { scrollRef, headingRef, measureHeading, onScroll } = useScrollTitle(museum?.name ?? "");
  if (!museum) {
    return (
      <ScrollView style={styles.root} contentInsetAdjustmentBehavior="automatic">
        <EmptyState title="This museum isn’t listed." />
      </ScrollView>
    );
  }
  const shows = museumExhibitions(data, museum);
  const facts = [
    { label: "Today", value: museum.hoursToday.replace(/^Open until/, "Until").replace(/^Closed today$/, "Closed") },
    { label: "Distance", value: `${museum.distanceMiles} mi` },
    ...(museum.admission ? [{ label: "Admission", value: museum.admission }] : []),
  ];
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
      {museum.photo && (
        <Image
          source={museum.photo}
          contentFit="cover"
          accessible={false}
          style={[styles.photo, { width: width - Spacing.content * 2 }]}
        />
      )}
      <View style={styles.details}>
        <Text variant="display" accessibilityRole="header" ref={headingRef} onLayout={measureHeading} selectable>
          {museum.name}
        </Text>
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
        <GalleryButton
          label="Directions"
          icon="arrow.triangle.turn.up.right.diamond"
          variant="outlined"
          fullWidth
          onPress={() => openDirections(museum)}
        />
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Gallery.paper },
  content: { paddingTop: Spacing.two, paddingBottom: Spacing.five },
  photo: { height: 210, marginHorizontal: Spacing.content, borderRadius: Radius.card },
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
  section: { paddingTop: Spacing.four, gap: Spacing.one },
  sectionTitle: { paddingHorizontal: Spacing.content },
  empty: { ...Typography.secondary, color: Gallery.muted, paddingHorizontal: Spacing.content },
});
