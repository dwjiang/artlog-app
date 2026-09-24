import { Button, Host, Icon } from "@expo/ui";
import {
  accessibilityLabel,
  contentShape,
  frame,
  shapes,
  strokeBorder,
} from "@expo/ui/swift-ui/modifiers";
import { router } from "expo-router";
import { useRef, useState, type ComponentProps } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { ThemedText as Text } from "@/components/themed-text";
import { useLocalOwner } from "@/lib/account/owner-store";
import { useGlobeSession } from "@/lib/journal/globe-session";
import { WallSheet } from "../collection/wall-sheet";
import { GalleryButton } from "../collection/gallery-button";
import { Gallery, Radius } from "@/constants/theme";
import { countryName, placeIdentity } from "@/lib/journal/history";
import {
  mappedMuseums,
  visitCounts,
  visitsAtPlace,
  type VisitSummary,
} from "@/lib/journal/visit-summaries";
import { GlobeCanvas, type GlobeCanvasHandle } from "./globe-canvas";
import { ArtworkPreviews, VisitMessage, VisitSymbol } from "./visit-ui";

export function VisitGlobe({
  visits,
  expanded = false,
  initialVenueId,
  onList,
}: {
  visits: VisitSummary[];
  expanded?: boolean;
  initialVenueId?: string;
  onList: () => void;
}) {
  const museums = mappedMuseums(visits);
  const session = useGlobeSession(useLocalOwner());
  const selectedId = session.selectedId ?? initialVenueId;
  const setSelectedId = (selectedId: string) => session.update({ selectedId });
  const [clusterIds, setClusterIds] = useState<string[]>([]);
  const selected =
    museums.find((visit) => visit.venueId === selectedId) ?? museums[0];
  const globe = useRef<GlobeCanvasHandle>(null);
  const { width } = useWindowDimensions();
  if (!selected) {
    return (
      <VisitMessage action="Show List" onAction={onList}>
        Globe locations are unavailable. Your visits are still in List.
      </VisitMessage>
    );
  }
  const pins = museums.map((visit) => ({
    id: visit.venueId,
    latitude: visit.coordinates!.latitude,
    longitude: visit.coordinates!.longitude,
    label: placeIdentity(visit).name,
  }));
  const initialPin = pins.find((pin) => pin.id === initialVenueId) ?? pins[0];
  const place = placeIdentity(selected);
  const placeVisits = visitsAtPlace(visits, place.key);
  const museumVisits = placeVisits.filter(
    (visit) => visit.venueId === selected.venueId,
  );
  const counts = visitCounts(museumVisits);
  const previews = museumVisits.flatMap((visit) => visit.works);
  const artworkCount = new Set(previews.map((work) => work.localId)).size;
  function select(id: string) {
    setSelectedId(id);
    const pin = pins.find((item) => item.id === id);
    if (pin) globe.current?.focus(pin);
  }
  return (
    <View>
      <View style={{ marginTop: 8 }}>
        <GlobeCanvas
          ref={globe}
          pins={pins}
          initialPin={initialPin}
          height={expanded ? Math.min(width, 390) : 337}
          onSelect={setSelectedId}
          initialCamera={session.camera}
          onCameraChange={(camera) => session.update({ camera })}
          onCluster={setClusterIds}
        />
        {!expanded && (
          <View style={styles.expand}>
            <GlobeButton
              label="Expand globe"
              icon="arrow.up.left.and.arrow.down.right"
              onPress={() => {
                globe.current?.settle();
                router.push({
                  pathname: "/visit-globe",
                  params: { venueId: selected.venueId },
                });
              }}
            />
          </View>
        )}
      </View>
      <View style={styles.placeWrap}>
        <Pressable
          style={styles.placeCard}
          accessibilityRole="button"
          accessibilityLabel={`View visits to ${selected.venueName}`}
          onPress={() => {
            const destination = {
              pathname: "/visit-place" as const,
              params: {
                placeKey: place.key,
                name: selected.venueName,
                venueId: selected.venueId,
              },
            };
            if (expanded) router.dismissTo(destination);
            else router.push(destination);
          }}
        >
          <View style={styles.placeTop}>
            <ArtworkPreviews works={previews} size={48} limit={1} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text variant="button">{selected.venueName}</Text>
              <Text style={styles.placeTitle}>
                {[place.name, countryName(selected.country)]
                  .filter(Boolean)
                  .join(", ")}
              </Text>
              <Text style={styles.counts}>
                {counts.visits} {counts.visits === 1 ? "visit" : "visits"} ·{" "}
                {artworkCount} {artworkCount === 1 ? "artwork" : "artworks"}
              </Text>
            </View>
            <VisitSymbol name="chevron.right" size={13} color={Gallery.ink} />
          </View>
        </Pressable>
      </View>
      {!!clusterIds.length && (
        <WallSheet title="Museums here" onDismiss={() => setClusterIds([])}>
          <View style={{ padding: 20, gap: 10 }}>
            {museums
              .filter((museum) => clusterIds.includes(museum.venueId))
              .map((museum) => (
                <GalleryButton
                  key={museum.venueId}
                  label={museum.venueName}
                  icon="building.columns"
                  onPress={() => {
                    select(museum.venueId);
                    setClusterIds([]);
                  }}
                />
              ))}
          </View>
        </WallSheet>
      )}
      {visits.some((visit) => !visit.coordinates) && (
        <VisitMessage action="Show List" onAction={onList}>
          Some visits have no globe location.
        </VisitMessage>
      )}
    </View>
  );
}
const GLOBE_BUTTON_RADIUS = 6;

function GlobeButton({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: ComponentProps<typeof Icon>["name"];
  onPress: () => void;
}) {
  return (
    <Host matchContents colorScheme="light">
      <Button
        onPress={onPress}
        variant="text"
        modifiers={[
          accessibilityLabel(label),
          // Stroke the rounded shape; a style border is square and loses its corners when clipped.
          strokeBorder({
            color: Gallery.separator,
            shape: "roundedRectangle",
            cornerRadius: GLOBE_BUTTON_RADIUS,
            style: { lineWidth: 1 },
          }),
        ]}
        style={{
          width: 44,
          height: 44,
          borderRadius: GLOBE_BUTTON_RADIUS,
          backgroundColor: Gallery.paper,
        }}
      >
        <Icon
          name={icon}
          size={14}
          color={Gallery.accent}
          modifiers={[
            frame({ width: 44, height: 44 }),
            contentShape(shapes.rectangle()),
          ]}
        />
      </Button>
    </Host>
  );
}
const styles = StyleSheet.create({
  expand: { position: "absolute", top: 4, right: 18 },
  placeWrap: { paddingHorizontal: 20, paddingBottom: 4 },
  placeCard: {
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Gallery.softBorder,
    borderRadius: Radius.input,
    backgroundColor: Gallery.surface,
  },
  placeTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  placeTitle: { fontSize: 13, lineHeight: 18, color: Gallery.muted },
  counts: { fontSize: 13, lineHeight: 18, color: Gallery.muted },
});
