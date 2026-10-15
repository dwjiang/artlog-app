import * as Sentry from "@sentry/react-native";
import { AppleMaps } from "expo-maps";
import { StyleSheet } from "react-native";

import { Gallery, Radius } from "@/constants/theme";
import type { ExploreMuseum } from "@/lib/explore/types";

/** A map around `museum`'s pin that a person can pan and zoom; it opens on the streets around the museum. */
export function LocationMap({ museum }: { museum: ExploreMuseum }) {
  const coordinates = { latitude: museum.lat, longitude: museum.lng };
  return (
    <Sentry.Mask>
      <AppleMaps.View
        style={styles.map}
        colorScheme={AppleMaps.MapColorScheme.LIGHT}
        cameraPosition={{ coordinates, zoom: 15 }}
        markers={[
          {
            id: museum.id,
            title: museum.name,
            systemImage: "building.columns",
            tintColor: Gallery.accent,
            coordinates,
          },
        ]}
        properties={{ isMyLocationEnabled: true, selectionEnabled: false }}
        uiSettings={{ myLocationButtonEnabled: false, scaleBarEnabled: false, togglePitchEnabled: false }}
      />
    </Sentry.Mask>
  );
}

const styles = StyleSheet.create({
  map: { height: 180, borderRadius: Radius.card, overflow: "hidden" },
});
