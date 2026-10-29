import { useNetworkState } from "expo-network";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { NativeSegmentedPicker } from "@/components/collection/native-segmented-picker";
import { EmptyState } from "@/components/empty-state";
import { SafeAreaSectionList } from "@/components/safe-area-scroll";
import { ThemedText as Text } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { savedExhibitions, savedMuseums } from "@/lib/explore/lists";
import type { Exhibition, ExploreCatalog, ExploreMuseum } from "@/lib/explore/types";
import { museumById, useExhibitions, useMuseums, type ExploreView } from "@/lib/explore/use-explore";
import { useWantToSee, useWantToSeeMuseums } from "@/lib/explore/want-to-see";
import { isOffline } from "@/lib/network-state";

import { ExhibitionRow } from "./exhibition-row";
import { ExploreStateMessage } from "./explore-state";
import { listStyles } from "./list-styles";
import { MuseumRow } from "./museum-list-screen";

type Tab = "exhibitions" | "museums";
type Saved =
  | { kind: "exhibition"; exhibition: Exhibition; catalog: ExploreCatalog }
  | { kind: "museum"; museum: ExploreMuseum; catalog: ExploreCatalog };
type Section = { key: string; title?: string; data: Saved[] };

const EMPTY = {
  exhibitions: {
    title: "No exhibitions in Want to see yet.",
    detail: "Tap the bookmark on an exhibition to add it here.",
  },
  museums: { title: "No museums in Want to see yet.", detail: "Tap the bookmark on a museum to add it here." },
};

/**
 * Saved shows in closing order, so the last chance comes first, with closed ones below until removed; saved museums on
 * their own tab. Both tabs load together, so a switch shows the other at once.
 */
export function WantToSeeScreen() {
  const [tab, setTab] = useState<Tab>("exhibitions");
  const savedShows = useWantToSee();
  const savedPlaces = useWantToSeeMuseums();
  const offline = isOffline(useNetworkState());
  const shows = useExhibitions([...savedShows.saved]);
  const places = useMuseums([...savedPlaces.saved]);
  const list = tab === "exhibitions" ? savedShows : savedPlaces;
  const view = tab === "exhibitions" ? shows : places;
  const pending: Pick<ExploreView, "status" | "retry"> | undefined = !list.ready
    ? { status: offline ? "offline" : list.error ? "error" : "loading", retry: list.retry }
    : view.data
      ? undefined
      : view;
  const sections = pending || !view.data ? [] : tabSections(tab, view.data, list.saved);
  return (
    <SafeAreaSectionList<Saved, Section>
      style={listStyles.root}
      contentInsetAdjustmentBehavior="automatic"
      bounces={sections.length > 0}
      contentContainerStyle={[listStyles.content, sections.length === 0 && { paddingBottom: 0 }]}
      sections={sections}
      keyExtractor={(item) => (item.kind === "museum" ? item.museum.id : item.exhibition.id)}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <View style={styles.picker}>
          <NativeSegmentedPicker
            label="Want to see"
            value={tab}
            onChange={setTab}
            options={[
              { value: "exhibitions", label: "Exhibitions" },
              { value: "museums", label: "Museums" },
            ]}
          />
        </View>
      }
      renderSectionHeader={({ section }) =>
        section.title ? (
          <Text variant="section" accessibilityRole="header" style={styles.heading}>
            {section.title}
          </Text>
        ) : null
      }
      renderItem={({ item, index, section }) => {
        const separator = index < section.data.length - 1;
        return item.kind === "museum" ? (
          <MuseumRow data={item.catalog} museum={item.museum} separator={separator} />
        ) : (
          <ExhibitionRow
            exhibition={item.exhibition}
            museum={museumById(item.catalog, item.exhibition.museumId)}
            today={item.catalog.today}
            thumbnail={88}
            separator={separator}
          />
        );
      }}
      ListEmptyComponent={
        pending ? (
          <View style={styles.state}>
            <ExploreStateMessage view={pending} subject={tab} />
          </View>
        ) : (
          <EmptyState {...EMPTY[tab]} />
        )
      }
    />
  );
}

// An empty section still counts as content, which would hide the empty state.
function tabSections(tab: Tab, catalog: ExploreCatalog, ids: ReadonlySet<string>): Section[] {
  if (tab === "museums") {
    const data = savedMuseums(catalog, ids).map((museum) => ({ kind: "museum" as const, museum, catalog }));
    return data.length > 0 ? [{ key: "museums", data }] : [];
  }
  const rows = (list: Exhibition[]) => list.map((exhibition) => ({ kind: "exhibition" as const, exhibition, catalog }));
  const { current, closed } = savedExhibitions(catalog, ids);
  return [
    { key: "current", data: rows(current) },
    { key: "closed", title: "Closed", data: rows(closed) },
  ].filter((section) => section.data.length > 0);
}

const styles = StyleSheet.create({
  picker: { paddingHorizontal: Spacing.content, paddingTop: Spacing.two, paddingBottom: Spacing.compact },
  heading: { paddingHorizontal: Spacing.content, paddingTop: Spacing.four, paddingBottom: Spacing.one },
  state: { flexGrow: 1, justifyContent: "center" },
});
