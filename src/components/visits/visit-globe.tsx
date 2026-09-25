import { Button, Host, Icon } from "@expo/ui";
import { accessibilityLabel, contentShape, frame, shapes, strokeBorder } from "@expo/ui/swift-ui/modifiers";
import { router } from "expo-router";
import { useRef, useState, type ComponentProps } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { WallSheet } from "@/components/collection/wall-sheet";
import { Gallery } from "@/constants/theme";
import { useLocalOwner } from "@/lib/account/owner-store";
import { useGlobeSession } from "@/lib/journal/globe-session";
import { placeIdentity } from "@/lib/journal/history";
import { mappedMuseums, type VisitSummary } from "@/lib/journal/visit-summaries";

import { GlobeCanvas, type GlobeCanvasHandle } from "./globe-canvas";
import { VisitMessage } from "./visit-ui";

export function VisitGlobe({
  visits,
  expanded = false,
  onList,
}: {
  visits: VisitSummary[];
  expanded?: boolean;
  onList: () => void;
}) {
  const museums = mappedMuseums(visits);
  const session = useGlobeSession(useLocalOwner());
  const [clusterIds, setClusterIds] = useState<string[]>([]);
  const globe = useRef<GlobeCanvasHandle>(null);
  const { width } = useWindowDimensions();
  if (museums.length === 0) {
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
    label: visit.venueName,
  }));
  function openMuseum(venueId: string) {
    const museum = museums.find((visit) => visit.venueId === venueId);
    if (!museum) return;
    const destination = {
      pathname: "/visit-place" as const,
      params: {
        placeKey: placeIdentity(museum).key,
        name: museum.venueName,
        venueId,
      },
    };
    if (expanded) router.dismissTo(destination);
    else router.push(destination);
  }
  return (
    <View>
      <View style={{ marginTop: 8 }}>
        <GlobeCanvas
          ref={globe}
          pins={pins}
          initialPin={pins[0]}
          height={expanded ? Math.min(width, 390) : 337}
          onSelect={openMuseum}
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
                router.push("/visit-globe");
              }}
            />
          </View>
        )}
      </View>
      {clusterIds.length > 0 && (
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
                    setClusterIds([]);
                    openMuseum(museum.venueId);
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
          modifiers={[frame({ width: 44, height: 44 }), contentShape(shapes.rectangle())]}
        />
      </Button>
    </Host>
  );
}
const styles = StyleSheet.create({
  expand: { position: "absolute", top: 4, right: 18 },
});
