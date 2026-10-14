import { Image } from "expo-image";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";

import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Spacing, Typography } from "@/constants/theme";
import {
  defaultTiming,
  exhibitionsByTiming,
  NO_EXHIBITIONS,
  timingLabel,
  type ExhibitionTiming,
} from "@/lib/explore/exhibition-timing";
import { friendPicks, nearbyMuseums } from "@/lib/explore/lists";
import { chooseCity, museumById, useExplore } from "@/lib/explore/use-explore";
import { useMyLocationAction } from "@/lib/explore/use-my-location";

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
  const { data } = explore;
  const myLocation = useMyLocationAction({ following: data?.following, home: data?.home });
  if (!data) return <ExploreState view={explore} />;
  const timing = chosenTiming ?? defaultTiming(data.exhibitions, data.today);
  const museums = nearbyMuseums(data);
  const shows = exhibitionsByTiming(data.exhibitions, timing, data.today);
  const picks = friendPicks(data).slice(0, FRIEND_PICKS_SHOWN);
  return (
    <>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Menu accessibilityLabel={`City, ${data.city.name}`} tintColor={Gallery.ink}>
          <Stack.Toolbar.Label>{data.city.name}</Stack.Toolbar.Label>
          <Stack.Toolbar.Menu inline>
            <Stack.Toolbar.MenuAction
              icon={myLocation.icon}
              isOn={myLocation.isOn}
              subtitle={myLocation.subtitle}
              onPress={myLocation.onPress}
            >
              {myLocation.label}
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
          <Stack.Toolbar.Menu inline>
            {data.cities.map((city) => (
              <Stack.Toolbar.MenuAction
                key={city.id}
                isOn={!data.following && city.id === data.city.id}
                onPress={() => chooseCity(city.id)}
              >
                {city.name}
              </Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
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
        {museums.length > 0 && (
          <View style={styles.section}>
            <ExploreSectionHeading
              title={data.nearby ? "Museums near you" : "Museums"}
              onSeeAll={() => router.push("/museums")}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {museums.map((museum) => (
                <MuseumTile key={museum.id} data={data} museum={museum} />
              ))}
            </ScrollView>
          </View>
        )}
      </ScrollView>
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
