import * as Sentry from "@sentry/react-native";
import { AppleMaps } from "expo-maps";
import { Stack } from "expo-router";
import { useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing } from "@/constants/theme";
import { nearbyMuseums } from "@/lib/explore/lists";
import type { ExploreMuseum } from "@/lib/explore/types";
import { useExplore } from "@/lib/explore/use-explore";

import { ExploreState } from "./explore-state";
import { MuseumRow } from "./museum-list-screen";

// At zoom 11 the full map height spans about this many degrees of latitude (measured on an iPhone 17 Pro); each zoom
// step halves it. The bar covers the top of the map and the list panel its lower part.
const SPAN_AT_ZOOM_11 = 0.32;
const BAR = 0.12;
const PANEL = 0.45;

/** Frames every museum in the strip of map between the bar and the list panel. */
function cameraBetweenBarAndPanel(museums: ExploreMuseum[]) {
  const lats = museums.map((museum) => museum.lat);
  const lngs = museums.map((museum) => museum.lng);
  const north = Math.max(...lats);
  const span = north - Math.min(...lats);
  // Labels hang below their pins, so the southern edge keeps more room.
  const above = span * 0.1;
  const below = span * 0.3;
  const screenSpan = Math.max(0.03, (span + above + below) / (1 - BAR - PANEL));
  return {
    coordinates: {
      latitude: north + above + screenSpan * BAR - screenSpan / 2,
      longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    },
    zoom: 11 + Math.log2(SPAN_AT_ZOOM_11 / screenSpan),
  };
}

export function ExploreMapScreen() {
  const explore = useExplore();
  const { bottom } = useSafeAreaInsets();
  const [selected, setSelected] = useState<string>();
  const list = useRef<ScrollView>(null);
  const { data } = explore;
  if (!data) return <ExploreState view={explore} />;
  const nearby = nearbyMuseums(data);
  // A tapped pin's museum leads the list; Expo Maps reports marker taps from iOS 18.
  const museums = [...nearby].sort((a, b) => Number(b.id === selected) - Number(a.id === selected));
  const canSelect = Number.parseInt(String(Platform.Version), 10) >= 18;
  const camera = cameraBetweenBarAndPanel(nearby);
  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: data.city.name }} />
      <Sentry.Mask style={StyleSheet.absoluteFill}>
        <AppleMaps.View
          style={StyleSheet.absoluteFill}
          colorScheme={AppleMaps.MapColorScheme.LIGHT}
          cameraPosition={camera}
          markers={nearby.map((museum) => ({
            id: museum.id,
            title: museum.name,
            systemImage: "building.columns",
            tintColor: museum.id === selected ? Gallery.accent : Gallery.ink,
            coordinates: { latitude: museum.lat, longitude: museum.lng },
          }))}
          properties={{ isMyLocationEnabled: true, selectionEnabled: false }}
          uiSettings={{ compassEnabled: false, scaleBarEnabled: false, togglePitchEnabled: false }}
          onMarkerClick={
            canSelect
              ? (marker) => {
                  if (marker.id) {
                    setSelected(marker.id);
                    list.current?.scrollTo({ y: 0, animated: false });
                  }
                }
              : undefined
          }
        />
      </Sentry.Mask>
      <View style={[styles.sheet, { paddingBottom: bottom }]}>
        <Text variant="section" accessibilityRole="header" style={styles.heading}>
          {`${nearby.length} museums nearby`}
        </Text>
        <ScrollView ref={list}>
          {museums.map((museum, index) => (
            <MuseumRow
              key={museum.id}
              data={data}
              museum={museum}
              selected={museum.id === selected}
              separator={index < museums.length - 1}
            />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Gallery.paper },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: `${PANEL * 100}%`,
    backgroundColor: Gallery.paper,
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    paddingTop: Spacing.three,
    shadowColor: Gallery.ink,
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
  },
  heading: { paddingHorizontal: Spacing.content, paddingBottom: Spacing.two },
});
