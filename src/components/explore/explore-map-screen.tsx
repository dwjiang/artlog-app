import * as Sentry from "@sentry/react-native";
import * as Location from "expo-location";
import { AppleMaps } from "expo-maps";
import { Stack } from "expo-router";
import { useRef, useState, type RefObject } from "react";
import { FlatList, Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Spacing } from "@/constants/theme";
import { nearbyMuseums } from "@/lib/explore/lists";
import { museumMapCamera } from "@/lib/explore/map-camera";
import type { ExploreMuseum } from "@/lib/explore/types";
import { useExplore } from "@/lib/explore/use-explore";
import { showLocationFailure } from "@/lib/explore/use-my-location";
import { reportError } from "@/lib/observability";
import { useVenue, type VenueView } from "@/lib/venue/use-venue";

import { ExploreState } from "./explore-state";
import { MuseumRow } from "./museum-list-screen";

// The list sits below the map because Apple's Maps terms forbid hiding MapKit's logo and Legal link.
const PANEL = 0.45;
// MapKit draws every pin unclustered, and a country's thousands of museums stall panning, so the list and its pins load
// the nearest in pages as the list scrolls.
const PAGE = 200;
// A few blocks around the phone.
const MY_LOCATION_ZOOM = 14;
// The map's pan would win over the stack's back swipe, so the screen edge where that swipe starts keeps touches off it.
const BACK_SWIPE_EDGE = 24;

/** Centers the map on a fresh fix rather than MapKit's own location, which stays put without saying why. */
function centerOnPhone(resolve: VenueView["resolve"], map: RefObject<AppleMaps.MapView | null>) {
  resolve()
    .then((located) => {
      if (located && "failure" in located) {
        showLocationFailure(located.failure, () => centerOnPhone(resolve, map));
      } else if (located) {
        return map.current?.setCameraPosition({
          coordinates: { latitude: located.fix.lat, longitude: located.fix.lng },
          zoom: MY_LOCATION_ZOOM,
        });
      }
    })
    .catch((cause: unknown) => reportError(cause, "explore.map.location", { level: "warning" }));
}

export function ExploreMapScreen() {
  const explore = useExplore();
  const { bottom, left, right } = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [mapHeight, setMapHeight] = useState(height * (1 - PANEL));
  const [selected, setSelected] = useState<string>();
  const [loaded, setLoaded] = useState(PAGE);
  const list = useRef<FlatList<ExploreMuseum>>(null);
  const map = useRef<AppleMaps.MapView>(null);
  const [location] = Location.useForegroundPermissions();
  const { resolve } = useVenue();
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
            onPress={() => centerOnPhone(resolve, map)}
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
        <View collapsable={false} style={styles.backSwipeEdge} />
      </Sentry.Mask>
      <View style={[styles.sheet, { paddingBottom: bottom, paddingLeft: left, paddingRight: right }]}>
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
  backSwipeEdge: { position: "absolute", top: 0, bottom: 0, left: 0, width: BACK_SWIPE_EDGE },
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
