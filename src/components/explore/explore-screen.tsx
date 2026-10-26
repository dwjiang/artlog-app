import { Image } from "expo-image";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, StyleSheet, View, useWindowDimensions } from "react-native";

import { SafeAreaScrollView } from "@/components/safe-area-scroll";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Spacing, Typography } from "@/constants/theme";
import { defaultTiming, NO_EXHIBITIONS, timingLabel, type ExhibitionTiming } from "@/lib/explore/exhibition-timing";
import { cityExhibitions, friendPicks, nearbyMuseums } from "@/lib/explore/lists";
import { museumById, useExplore } from "@/lib/explore/use-explore";
import { useSafeAreaBleed } from "@/lib/ui/safe-area";

import { CityMenu } from "./city-menu";
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
  const [chosenTiming, setTiming] = useState<ExhibitionTiming>();
  const row = useSafeAreaBleed(styles.row);
  const { data } = explore;
  if (!data) return <ExploreState view={explore} />;
  const timing = chosenTiming ?? defaultTiming(data.exhibitions, data.today);
  const museums = nearbyMuseums(data);
  const shows = cityExhibitions(data, timing);
  const picks = friendPicks(data).slice(0, FRIEND_PICKS_SHOWN);
  return (
    <>
      <CityMenu city={data.city} cities={data.cities} following={data.following} home={data.home} />
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
      <SafeAreaScrollView
        style={styles.root}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
      >
        {data.following && data.home && !data.nearby && (
          <ElsewhereNote home={data.home} city={data.city.name} distance={museums[0]?.distance} />
        )}
        <View style={styles.section}>
          <ExploreSectionHeading
            title={timingLabel(timing)}
            heading={<TimingMenuHeading value={timing} onChange={setTiming} />}
            onSeeAll={() => router.push({ pathname: "/exhibitions", params: { timing } })}
          />
          {shows.length > 0 ? (
            // Keyed by timing so a new choice starts at its first show. A country lists over a thousand, so cards are
            // drawn as the row scrolls to them.
            <FlatList
              key={timing}
              horizontal
              showsHorizontalScrollIndicator={false}
              style={row.style}
              contentContainerStyle={row.contentContainerStyle}
              data={shows}
              keyExtractor={(exhibition) => exhibition.id}
              renderItem={({ item }) => (
                <ExhibitionCard exhibition={item} museum={museumById(data, item.museumId)} today={data.today} />
              )}
            />
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
        {museums.length > 0 && (
          <View style={styles.section}>
            <ExploreSectionHeading
              title={data.nearby ? "Museums near you" : "Museums"}
              onSeeAll={() => router.push("/museums")}
            />
            {/* A country lists thousands of museums, so tiles are drawn as the row scrolls to them. */}
            <FlatList
              testID="museum-row"
              horizontal
              showsHorizontalScrollIndicator={false}
              style={row.style}
              contentContainerStyle={row.contentContainerStyle}
              data={museums}
              keyExtractor={(museum) => museum.id}
              renderItem={({ item }) => <MuseumTile data={data} museum={item} />}
            />
          </View>
        )}
      </SafeAreaScrollView>
    </>
  );
}

/** Says why Explore opened a city other than the phone's own. */
function ElsewhereNote({ home, city, distance }: { home: string; city: string; distance?: string }) {
  const { fontScale } = useWindowDimensions();
  return (
    <View style={styles.note}>
      <Image
        source="sf:mappin"
        tintColor={Gallery.muted}
        accessible={false}
        style={{ width: 15 * fontScale, height: 15 * fontScale, marginTop: 3 * fontScale }}
      />
      <Text style={styles.noteText}>
        {`Nothing listed in ${home} yet. Showing ${city}${distance ? `, ${distance} away` : ""}.`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Gallery.paper },
  content: { paddingTop: Spacing.two, paddingBottom: Spacing.five, gap: Spacing.five },
  section: { gap: Spacing.compact },
  row: { gap: Spacing.compact, paddingHorizontal: Spacing.content },
  empty: { ...Typography.secondary, color: Gallery.muted, paddingHorizontal: Spacing.content },
  note: { flexDirection: "row", gap: Spacing.one + Spacing.half, paddingHorizontal: Spacing.content },
  noteText: { ...Typography.secondary, color: Gallery.muted, flexShrink: 1 },
});
