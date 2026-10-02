import { AppleMaps } from "expo-maps";
import { useEffect, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Gallery, Radius, Spacing } from "@/constants/theme";
import { reportError } from "@/lib/observability";
import type { Coordinate } from "@/lib/venue/resolve";
import { venueMetadataForIds } from "@/lib/venue/venue-db";
import { venueOptionKey, type VenueOption } from "@/lib/venue/venue-reducer";

export type MuseumPin = Coordinate & { key: string; name: string };

/** Where each listed museum is: MapKit places carry their own position, seeded rows are looked up in the venue table. */
export function useOptionCoordinates(options: VenueOption[]): Map<string, Coordinate> {
  const [seeded, setSeeded] = useState<Map<string, Coordinate>>(new Map());
  const ids = options.filter((option) => option.kind === "seeded").map((option) => option.venueId);
  const wanted = ids.join(",");
  useEffect(() => {
    if (!wanted) return;
    let active = true;
    venueMetadataForIds(wanted.split(","))
      .then((rows) => {
        if (active) setSeeded(new Map(rows.map((row) => [row.id, { lat: row.lat, lng: row.lng }])));
      })
      .catch((error: unknown) => {
        reportError(error, "venue.map.coordinates", { level: "warning" });
      });
    return () => {
      active = false;
    };
  }, [wanted]);
  const found = new Map<string, Coordinate>();
  for (const option of options) {
    const key = venueOptionKey(option);
    const coordinate = option.kind === "poi" ? { lat: option.lat, lng: option.lng } : seeded.get(option.venueId);
    if (coordinate) found.set(key, coordinate);
  }
  return found;
}

// On iOS 17, Expo Maps cannot select markers, so the map is a preview for the list below it.
export function MuseumMap({
  center,
  pins,
  selectedKey,
  onSelect,
}: {
  center: Coordinate;
  pins: MuseumPin[];
  selectedKey?: string;
  onSelect: (key: string) => void;
}) {
  const canSelect = Number.parseInt(String(Platform.Version), 10) >= 18;
  return (
    <View style={styles.container}>
      <View pointerEvents={canSelect ? "auto" : "none"} accessibilityElementsHidden={!canSelect}>
        <AppleMaps.View
          style={styles.map}
          colorScheme={AppleMaps.MapColorScheme.LIGHT}
          cameraPosition={{ coordinates: { latitude: center.lat, longitude: center.lng }, zoom: 16 }}
          markers={pins.map((pin) => ({
            id: pin.key,
            title: pin.name,
            systemImage: "building.columns",
            tintColor: pin.key === selectedKey ? Gallery.accent : Gallery.controlBorder,
            coordinates: { latitude: pin.lat, longitude: pin.lng },
          }))}
          properties={{ isMyLocationEnabled: true, selectionEnabled: false }}
          uiSettings={{
            compassEnabled: false,
            myLocationButtonEnabled: false,
            scaleBarEnabled: false,
            togglePitchEnabled: false,
          }}
          onMarkerClick={
            canSelect
              ? (marker) => {
                  if (marker.id) onSelect(marker.id);
                }
              : undefined
          }
        />
      </View>
      {!canSelect && (
        <ThemedText type="small" themeColor="textSecondary">
          Choose a museum from the list below.
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.one },
  map: { height: 190, borderRadius: Radius.card, overflow: "hidden" },
});
