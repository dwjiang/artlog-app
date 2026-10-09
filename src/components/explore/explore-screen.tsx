import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Spacing, Typography } from "@/constants/theme";
import {
  exhibitionsByTiming,
  NO_EXHIBITIONS,
  timingLabel,
  type ExhibitionTiming,
} from "@/lib/explore/exhibition-timing";
import { friendPicks, nearbyMuseums } from "@/lib/explore/lists";
import { chooseCity, museumById, useExplore } from "@/lib/explore/use-explore";

import { ExhibitionCard } from "./exhibition-card";
import { ExhibitionRow } from "./exhibition-row";
import { ExploreSectionHeading } from "./explore-section";
import { ExploreState } from "./explore-state";
import { MuseumTile } from "./museum-tile";
import { TimingMenuHeading } from "./timing-menu";

const FRIEND_PICKS_SHOWN = 3;

export function ExploreScreen() {
  const router = useRouter();
  const explore = useExplore();
  const [timing, setTiming] = useState<ExhibitionTiming>("ending");
  const { data } = explore;
  if (!data) return <ExploreState view={explore} />;
  const museums = nearbyMuseums(data);
  const shows = exhibitionsByTiming(data.exhibitions, timing, data.today);
  const picks = friendPicks(data).slice(0, FRIEND_PICKS_SHOWN);
  return (
    <>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Menu accessibilityLabel={`City, ${data.city.name}`} tintColor={Gallery.ink}>
          <Stack.Toolbar.Label>{data.city.name}</Stack.Toolbar.Label>
          {data.cities.map((city) => (
            <Stack.Toolbar.MenuAction key={city.id} isOn={city.id === data.city.id} onPress={() => chooseCity(city.id)}>
              {city.name}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon="map"
          accessibilityLabel="Map"
          tintColor={Gallery.ink}
          onPress={() => router.push("/explore-map")}
        />
        <Stack.Toolbar.Button
          icon="bookmark"
          accessibilityLabel="Want to see"
          tintColor={Gallery.ink}
          onPress={() => router.push("/want-to-see")}
        />
      </Stack.Toolbar>
      <ScrollView style={styles.root} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <ExploreSectionHeading
            title={timingLabel(timing)}
            heading={<TimingMenuHeading value={timing} onChange={setTiming} />}
            onSeeAll={() => router.push({ pathname: "/exhibitions", params: { timing } })}
          />
          {shows.length > 0 ? (
            // Keyed by timing so a new choice starts at its first show.
            <ScrollView
              key={timing}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.row}
            >
              {shows.map((exhibition) => (
                <ExhibitionCard
                  key={exhibition.id}
                  exhibition={exhibition}
                  museum={museumById(data, exhibition.museumId)}
                  today={data.today}
                />
              ))}
            </ScrollView>
          ) : (
            <Text style={styles.empty}>{NO_EXHIBITIONS[timing]}</Text>
          )}
        </View>
        {picks.length > 0 && (
          <View>
            <ExploreSectionHeading title="Friends want to see" onSeeAll={() => router.push("/friends-want-to-see")} />
            {picks.map((exhibition, index) => (
              <ExhibitionRow
                key={exhibition.id}
                exhibition={exhibition}
                today={data.today}
                separator={index < picks.length - 1}
              />
            ))}
          </View>
        )}
        <View style={styles.section}>
          <ExploreSectionHeading
            title={museums[0]?.distanceM === undefined ? "Museums" : "Museums near you"}
            onSeeAll={() => router.push("/museums")}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {museums.map((museum) => (
              <MuseumTile key={museum.id} data={data} museum={museum} />
            ))}
          </ScrollView>
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Gallery.paper },
  content: { paddingTop: Spacing.two, paddingBottom: Spacing.five, gap: Spacing.five },
  section: { gap: Spacing.compact },
  row: { gap: Spacing.compact, paddingHorizontal: Spacing.content },
  empty: { ...Typography.secondary, color: Gallery.muted, paddingHorizontal: Spacing.content },
});
