import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";

import { ChoiceMenu } from "@/components/choice-menu";
import { ThemedText as Text } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { isTiming, NO_EXHIBITIONS, TIMING_OPTIONS, type ExhibitionTiming } from "@/lib/explore/exhibition-timing";
import { cityExhibitions } from "@/lib/explore/lists";
import { museumById, useExplore } from "@/lib/explore/use-explore";

import { ExhibitionRow } from "./exhibition-row";
import { ExploreState } from "./explore-state";
import { listStyles } from "./list-styles";

/** Every show for one timing, opened from the Explore row's See all with that row's choice. */
export function ExhibitionListScreen() {
  const params = useLocalSearchParams<{ timing?: string }>();
  const [timing, setTiming] = useState<ExhibitionTiming>(isTiming(params.timing) ? params.timing : "now");
  const explore = useExplore();
  const { data } = explore;
  if (!data) return <ExploreState view={explore} />;
  const shows = cityExhibitions(data, timing);
  return (
    <FlatList
      style={listStyles.root}
      contentInsetAdjustmentBehavior="automatic"
      bounces={shows.length > 0}
      contentContainerStyle={[listStyles.content, shows.length === 0 && { paddingBottom: 0 }]}
      data={shows}
      keyExtractor={(exhibition) => exhibition.id}
      ListHeaderComponent={
        <View style={styles.filter}>
          <ChoiceMenu label="Exhibitions" value={timing} options={TIMING_OPTIONS} onChange={setTiming} />
        </View>
      }
      renderItem={({ item, index }) => (
        <ExhibitionRow
          exhibition={item}
          museum={museumById(data, item.museumId)}
          today={data.today}
          thumbnail={88}
          separator={index < shows.length - 1}
        />
      )}
      ListEmptyComponent={<Text style={listStyles.empty}>{NO_EXHIBITIONS[timing]}</Text>}
    />
  );
}

const styles = StyleSheet.create({
  filter: { paddingHorizontal: Spacing.content, paddingTop: Spacing.two, flexDirection: "row" },
});
