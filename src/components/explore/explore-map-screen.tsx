import * as Sentry from "@sentry/react-native";
import * as Location from "expo-location";
import { AppleMaps } from "expo-maps";
import { Stack } from "expo-router";
import { useRef, useState } from "react";
import { FlatList, Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Spacing } from "@/constants/theme";
import { nearbyMuseums } from "@/lib/explore/lists";
import { museumMapCamera } from "@/lib/explore/map-camera";
import type { ExploreMuseum } from "@/lib/explore/types";
import { useExplore } from "@/lib/explore/use-explore";

import { ExploreState } from "./explore-state";
import { MuseumRow } from "./museum-list-screen";

// The list sits below the map because Apple's Maps terms forbid hiding MapKit's logo and Legal link.
const PANEL = 0.45;
// MapKit draws every pin unclustered, and a country's thousands of museums stall panning, so the list and its pins load
// the nearest in pages as the list scrolls.
const PAGE = 200;

export function ExploreMapScreen() {
  const explore = useExplore();
  const { bottom } = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [mapHeight, setMapHeight] = useState(height * (1 - PANEL));
  const [selected, setSelected] = useState<string>();
  const [loaded, setLoaded] = useState(PAGE);
  const list = useRef<FlatList<ExploreMuseum>>(null);
  const map = useRef<AppleMaps.MapView>(null);
  const [location] = Location.useForegroundPermissions();
  const { data } = explore;
  if (!data) return <ExploreState view={explore} />;
  const all = nearbyMuseums(data);
  const nearby = all.slice(0, loaded);
  // A tapped pin's museum leads the list; Expo Maps reports marker taps from iOS 18.
  const museums = [...nearby].sort((a, b) => Number(b.id === selected) - Number(a.id === selected));
  const canSelect = Number.parseInt(String(Platform.Version), 10) >= 18;
  const camera = museumMapCamera(nearby, mapHeight / height);
  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: data.city.name }} />
      {location?.granted && (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="location"
            accessibilityLabel="My Location"
            tintColor={Gallery.ink}
            onPress={() => map.current?.setCameraPosition()}
          />
        </Stack.Toolbar>
      )}
      <Sentry.Mask style={styles.map} onLayout={(event) => setMapHeight(event.nativeEvent.layout.height)}>
        <AppleMaps.View
          ref={map}
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
          // MapKit keeps its own controls inside the safe area, below the transparent header, so the location button
          // lives in the header instead.
          uiSettings={{
            compassEnabled: false,
            myLocationButtonEnabled: false,
            scaleBarEnabled: false,
            togglePitchEnabled: false,
          }}
          onMarkerClick={
            canSelect
              ? (marker) => {
                  if (marker.id) {
                    setSelected(marker.id);
                    list.current?.scrollToOffset({ offset: 0, animated: false });
                  }
                }
              : undefined
          }
        />
      </Sentry.Mask>
      <View style={[styles.sheet, { paddingBottom: bottom }]}>
        <Text variant="section" accessibilityRole="header" style={styles.heading}>
          {`${all.length.toLocaleString()} museums nearby`}
        </Text>
        <FlatList
          ref={list}
          testID="museum-list"
          data={museums}
          onEndReached={() => {
            if (loaded < all.length) setLoaded(loaded + PAGE);
          }}
          keyExtractor={(museum) => museum.id}
          renderItem={({ item, index }) => (
            <MuseumRow
              data={data}
              museum={item}
              selected={item.id === selected}
              separator={index < museums.length - 1}
            />
          )}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Gallery.paper },
  map: { flex: 1 },
  sheet: {
    maxHeight: `${PANEL * 100}%`,
    backgroundColor: Gallery.paper,
    paddingTop: Spacing.three,
    shadowColor: Gallery.ink,
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
  },
  heading: { paddingHorizontal: Spacing.content, paddingBottom: Spacing.two },
});
