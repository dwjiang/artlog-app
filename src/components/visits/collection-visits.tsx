import { router } from "expo-router";
import type { ReactElement } from "react";
import { ScrollView, View, useWindowDimensions } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { NativeSegmentedPicker } from "@/components/collection/native-segmented-picker";
import { SearchEmptyState } from "@/components/empty-state";
import { CollectionEmptyState } from "@/components/guest/collection-empty-state";
import { ListSkeleton } from "@/components/loading-skeleton";
import { SearchField } from "@/components/search-field";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { searchTerm } from "@/lib/journal/query";
import { useVisitView } from "@/lib/journal/use-visit-view";
import { searchVisitSummaries, type VisitSummary } from "@/lib/journal/visit-summaries";

import { VisitGlobe } from "./visit-globe";
import { VisitTimeline } from "./visit-timeline";
import { VisitMessage, VisitPrivacyNote, visitStyles as styles } from "./visit-ui";

export function CollectionVisits({
  owner,
  visits,
  search,
  header,
  collectionControls,
  loading,
  error,
  clearSearch,
  onSearchChange,
}: {
  owner: string;
  visits: VisitSummary[];
  search: string;
  header?: ReactElement;
  collectionControls?: ReactElement;
  loading: boolean;
  error?: Error;
  clearSearch: () => void;
  onSearchChange: (value: string) => void;
}) {
  const { mode, changeMode, error: preferenceError } = useVisitView(owner);
  const { fontScale } = useWindowDimensions();
  const shown = searchVisitSummaries(visits, search);
  if (!loading && !error && visits.length === 0 && !search.trim()) {
    return (
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 24 }}>
        {header}
        {collectionControls}
        <CollectionEmptyState kind="visits" />
      </ScrollView>
    );
  }
  const controls = (
    <View style={{ backgroundColor: Gallery.paper }}>
      {collectionControls}
      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: 4,
          gap: 12,
          paddingBottom: 10,
        }}
      >
        <View
          style={{
            flexDirection: fontScale > 1.5 ? "column" : "row",
            alignItems: fontScale > 1.5 ? "stretch" : "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <NativeSegmentedPicker
            compact
            label="Visit view"
            value={mode}
            disabled={!mode}
            onChange={changeMode}
            options={[
              { value: "globe", label: "Globe", icon: "globe" },
              { value: "list", label: "List", icon: "list.bullet" },
            ]}
          />
          <GalleryButton label="Add visit" icon="plus" onPress={() => router.push("/visit-add")} />
        </View>
        {mode === "list" && (
          <SearchField
            value={search}
            label="Search your visits"
            showLabel={false}
            filled
            onChange={onSearchChange}
            onClear={clearSearch}
          />
        )}
        {preferenceError && <Text style={styles.error}>{preferenceError}</Text>}
      </View>
    </View>
  );
  let message: ReactElement | undefined;
  if (error) {
    message = (
      <VisitMessage action="Go to Scan" onAction={() => router.push("/scan")}>
        Your visits could not load. Reopen Collection to try again.
      </VisitMessage>
    );
  }
  // `loading` also covers the venue metadata read, so visits never render without their places.
  else if (!mode || loading) {
    message =
      mode === "list" ? (
        <ListSkeleton label="Loading your visits…" rows={3} />
      ) : (
        <VisitMessage loading>Loading your visits…</VisitMessage>
      );
  } else if (mode === "list" && shown.length === 0) {
    message = (
      <SearchEmptyState
        title="No visits found."
        detail={
          searchTerm(search) === null ? "Enter between 2 and 100 characters to search." : "Try a museum, city, or date."
        }
        onClear={clearSearch}
      />
    );
  }
  // Keep the native scroll view, header, and controls mounted across view changes.
  return (
    <VisitTimeline
      visits={mode === "list" && !message ? shown : []}
      header={header}
      controls={controls}
      scrollResetKey={mode}
      footer={
        mode === "globe" ? (
          (message ?? <VisitGlobe visits={visits} onList={() => changeMode("list")} />)
        ) : (
          <>
            {message}
            <VisitPrivacyNote />
          </>
        )
      }
    />
  );
}
