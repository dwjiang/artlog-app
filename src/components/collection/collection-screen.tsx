import { useNetworkState } from "expo-network";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { usePaneSwitch, type PaneRoom } from "@/components/pane-scroll";
import { ThemedText as Text } from "@/components/themed-text";
import { CollectionVisits } from "@/components/visits/collection-visits";
import { Gallery } from "@/constants/theme";
import { useLocalOwner } from "@/lib/account/owner-store";
import { useCollectionData } from "@/lib/collection/use-collection-data";
import { isOffline } from "@/lib/network-state";

import { CollectionHeader } from "./collection-header";
import { CollectionWall } from "./collection-wall";
import { NativeSegmentedPicker } from "./native-segmented-picker";

export function CollectionScreen() {
  return <CollectionSession key={useLocalOwner()} />;
}

function CollectionSession() {
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<ReturnType<typeof useCollectionData>>();
  const [mode, setMode] = useState<"collection" | "visits">("collection");
  const { view } = useLocalSearchParams<{ view?: string }>();
  useFocusEffect(
    useCallback(() => {
      if (view !== "wall" && view !== "visits") return;
      setMode(view === "wall" ? "collection" : "visits");
      router.setParams({ view: undefined });
    }, [view]),
  );
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState("");
  return (
    <>
      <CollectionDataReader key={attempt} onData={setData} />
      {data && (
        <OwnedCollection
          data={data}
          mode={mode}
          setMode={setMode}
          editing={editing}
          setEditing={setEditing}
          search={search}
          setSearch={setSearch}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      )}
    </>
  );
}

// Drizzle retains query errors until remount. Reset only its reader so recovery preserves the editor and visits.
// Memoization keeps publishing data from triggering another read/render of this component through its parent.
const CollectionDataReader = memo(function CollectionDataReader({
  onData,
}: {
  onData: (data: ReturnType<typeof useCollectionData>) => void;
}) {
  const data = useCollectionData();
  useEffect(() => onData(data), [data, onData]);
  return null;
});

function OwnedCollection({
  data,
  mode,
  setMode,
  editing,
  setEditing,
  search,
  setSearch,
  onRetry,
}: {
  data: ReturnType<typeof useCollectionData>;
  mode: "collection" | "visits";
  setMode: (mode: "collection" | "visits") => void;
  editing: boolean;
  setEditing: (editing: boolean) => void;
  search: string;
  setSearch: (search: string) => void;
  onRetry: () => void;
}) {
  const network = useNetworkState();
  const wallPane = useRef<PaneRoom>(null);
  const visitsPane = useRef<PaneRoom>(null);
  const preparePane = usePaneSwitch(mode, (pane) => (pane === "collection" ? wallPane : visitsPane).current);
  const controls = (
    <View
      style={{
        paddingHorizontal: 20,
        paddingBottom: 12,
        backgroundColor: Gallery.paper,
      }}
    >
      <NativeSegmentedPicker
        label="Collection view"
        value={mode}
        onChange={(next) => {
          preparePane(next);
          setMode(next);
        }}
        disabled={editing}
        options={[
          { value: "collection", label: "Wall" },
          { value: "visits", label: "Visits" },
        ]}
      />
    </View>
  );
  const header = (
    <>
      <CollectionHeader
        loading={data.loading && data.works.length === 0 && data.visits.length === 0 && !data.error}
        artworkCount={data.works.length}
        visitCount={data.visits.length}
      />
      {isOffline(network) && (
        <View
          style={{
            marginHorizontal: 20,
            marginBottom: 12,
            padding: 12,
            borderRadius: 8,
            backgroundColor: Gallery.fill,
          }}
        >
          <Text style={{ color: Gallery.muted, fontSize: 13 }}>
            Offline · Your saved collection is available on this iPhone.
          </Text>
        </View>
      )}
    </>
  );
  const collection = (
    <CollectionSection key="collection" shown={mode === "collection"}>
      <CollectionWall
        works={data.works}
        visits={data.visits}
        collectionLoading={data.loading}
        collectionError={data.error ? "Your collection could not load. Try again." : undefined}
        onCollectionRetry={onRetry}
        hiddenIds={data.hiddenIds}
        onEditingChange={setEditing}
        paneRef={wallPane}
        header={header}
        controls={controls}
      />
    </CollectionSection>
  );
  const visits = (
    <CollectionSection key="visits" shown={mode === "visits"}>
      <CollectionVisits
        {...data}
        header={header}
        collectionControls={controls}
        paneRef={visitsPane}
        search={search}
        onSearchChange={setSearch}
        clearSearch={() => setSearch("")}
        onRetry={onRetry}
      />
    </CollectionSection>
  );
  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: Gallery.paper }}>
      {/* The shown section comes first: react-native-screens scrolls the first subview chain to the top on a tab re-tap. */}
      <View style={{ flex: 1 }}>{mode === "collection" ? [collection, visits] : [visits, collection]}</View>
    </SafeAreaView>
  );
}

// Fabric never mounts `display: "none"` views, so showing one defers SwiftUI sizing and can shift the page.
// The hidden section stays mounted, invisible and out of reach. Unless it is
// `collapsable={false}`, Fabric flattens the shown wrapper away and reinserts its scroll view, which restores its offset
// from shadow state; that trails a scroll `usePaneSwitch` has just made.
function CollectionSection({ shown, children }: { shown: boolean; children: ReactNode }) {
  return (
    <View
      collapsable={false}
      accessibilityElementsHidden={!shown}
      pointerEvents={shown ? "auto" : "none"}
      style={[StyleSheet.absoluteFill, { opacity: shown ? 1 : 0 }]}
    >
      {children}
    </View>
  );
}
