import { useNetworkState } from "expo-network";
import { SectionList, StyleSheet } from "react-native";

import { EmptyState } from "@/components/empty-state";
import { ThemedText as Text } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { savedExhibitions } from "@/lib/explore/lists";
import { museumById, useExhibitions } from "@/lib/explore/use-explore";
import { useWantToSee } from "@/lib/explore/want-to-see";
import { isOffline } from "@/lib/network-state";

import { ExhibitionRow } from "./exhibition-row";
import { ExploreState } from "./explore-state";
import { listStyles } from "./list-styles";

/** Saved shows in closing order, so the last chance comes first; closed ones stay below until removed. */
export function WantToSeeScreen() {
  const { saved: ids, ready, error, retry } = useWantToSee();
  const offline = isOffline(useNetworkState());
  const explore = useExhibitions([...ids]);
  const { data } = explore;
  if (!ready) return <ExploreState view={{ status: offline ? "offline" : error ? "error" : "loading", retry }} />;
  if (!data) return <ExploreState view={explore} />;
  const { current, closed } = savedExhibitions(data, ids);
  // An empty section still counts as content, which would hide the empty state.
  const sections = [
    { key: "current", data: current },
    { key: "closed", title: "Closed", data: closed },
  ].filter((section) => section.data.length > 0);
  return (
    <SectionList
      style={listStyles.root}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[listStyles.content, sections.length === 0 && { flexGrow: 1 }]}
      sections={sections}
      keyExtractor={(exhibition) => exhibition.id}
      stickySectionHeadersEnabled={false}
      renderSectionHeader={({ section }) =>
        section.title ? (
          <Text variant="section" accessibilityRole="header" style={styles.heading}>
            {section.title}
          </Text>
        ) : null
      }
      renderItem={({ item, index, section }) => (
        <ExhibitionRow
          exhibition={item}
          museum={museumById(data, item.museumId)}
          today={data.today}
          thumbnail={88}
          separator={index < section.data.length - 1}
        />
      )}
      ListEmptyComponent={
        <EmptyState title="Nothing saved yet." detail="Tap the bookmark on an exhibition to save it here." />
      }
    />
  );
}

const styles = StyleSheet.create({
  heading: { paddingHorizontal: Spacing.content, paddingTop: Spacing.four, paddingBottom: Spacing.one },
});
