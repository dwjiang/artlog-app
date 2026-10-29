import { router } from "expo-router";
import { useState, type ReactElement, type Ref } from "react";
import { View, useWindowDimensions } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { NativeSegmentedPicker } from "@/components/collection/native-segmented-picker";
import { SearchEmptyState } from "@/components/empty-state";
import { CollectionEmptyState } from "@/components/guest/collection-empty-state";
import { ListSkeleton } from "@/components/loading-skeleton";
import type { PaneRoom } from "@/components/pane-scroll";
import { SearchField } from "@/components/search-field";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { searchTerm } from "@/lib/journal/query";
import { useVisitView } from "@/lib/journal/use-visit-view";
import { searchVisitSummaries, type VisitSummary } from "@/lib/journal/visit-summaries";
import { LIMITS } from "@/shared/journal/limits";

import { VisitGlobe } from "./visit-globe";
import { VisitTimeline } from "./visit-timeline";
import { VisitMessage, VisitPrivacyNote, visitStyles as styles } from "./visit-ui";

export function CollectionVisits({
  owner,
  visits,
  search,
  header,
  collectionControls,
  paneRef,
  loading,
  error,
  clearSearch,
  onSearchChange,
  onRetry,
}: {
  owner: string;
  visits: VisitSummary[];
  search: string;
  header?: ReactElement;
  collectionControls?: ReactElement;
  paneRef?: Ref<PaneRoom>;
  loading: boolean;
  error?: Error;
  clearSearch: () => void;
  onSearchChange: (value: string) => void;
  onRetry: () => void;
}) {
  const { mode, changeMode, error: preferenceError } = useVisitView(owner);
  const { fontScale } = useWindowDimensions();
  const [loaded, setLoaded] = useState<{ owner: string; visits: VisitSummary[] }>();
  if (!loading && !error && (loaded?.owner !== owner || loaded.visits !== visits)) {
    setLoaded({ owner, visits });
  }
  const available = loading || error ? (loaded?.owner === owner ? loaded.visits : []) : visits;
  const shown = searchVisitSummaries(available, search);
  if (!loading && !error && visits.length === 0 && !search.trim()) {
    return (
      <VisitTimeline
        visits={[]}
        header={header}
        controls={collectionControls}
        paneRef={paneRef}
        footer={<CollectionEmptyState kind="visits" />}
        empty
      />
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
          <GalleryButton label="Add Visit" icon="plus" onPress={() => router.push("/visit-add")} />
        </View>
        {mode === "list" && (
          <SearchField
            value={search}
            label="Search your visits"
            showLabel={false}
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
      <VisitMessage action="Try again" onAction={onRetry}>
        Your visits could not load. Try again.
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
          searchTerm(search) === null ? `Use up to ${LIMITS.searchMax} characters.` : "Try a museum, city, or date."
        }
        onClear={clearSearch}
      />
    );
  }
  const showContent = !message || (!!mode && (loading || !!error) && available.length > 0);
  // Keep the native scroll view, header, and controls mounted across view changes, including the empty state above.
  return (
    <VisitTimeline
      visits={mode === "list" && showContent ? shown : []}
      header={header}
      controls={controls}
      paneRef={paneRef}
      pane={mode}
      empty={!showContent}
      footer={
        mode === "globe" ? (
          <>
            {message}
            {showContent && <VisitGlobe visits={available} onList={() => changeMode("list")} />}
          </>
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
