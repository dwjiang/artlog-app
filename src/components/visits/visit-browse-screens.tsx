import { useListeningDockInset } from "@/components/audio/use-listening-dock-inset";
import { SavedWorkImage } from "../collection/saved-work-image";
import { formatVisitDate, placeIdentity } from "@/lib/journal/history";
import { useState } from "react";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Typography } from "@/constants/theme";
import { NativeSegmentedPicker } from "../collection/native-segmented-picker";
import { EmptyState, EmptySymbol } from "../empty-state";
import { GalleryButton } from "../collection/gallery-button";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { FlatList, Pressable, ScrollView, View } from "react-native";
import { useLocalOwner } from "@/lib/account/owner-store";
import { useVisits } from "@/lib/journal/use-visits";
import { visitCounts, visitsAtPlace } from "@/lib/journal/visit-summaries";
import { VisitGlobe } from "./visit-globe";
import { VisitRow } from "./visit-timeline";
import { VisitMessage, VisitPage } from "./visit-ui";

export function VisitPlaceScreen() {
  const dockInset = useListeningDockInset();
  const { placeKey, name, venueId } = useLocalSearchParams<{
    placeKey: string;
    name: string;
    venueId?: string;
  }>();
  const { visits, loading, error } = useVisits();
  const matches = visitsAtPlace(visits, placeKey).filter(
    (visit) => !venueId || visit.venueId === venueId,
  );
  return (
    <View style={{ flex: 1, paddingBottom: dockInset }}>
      <Stack.Screen options={{ title: name || "Visits by museum" }} />
      {error || loading ? (
        <VisitPage>
          <VisitMessage
            loading={loading && !error}
            skeleton="list"
            action="Back to Collection"
            onAction={() => router.back()}
          >
            {error ? "Visits could not load." : "Loading visits…"}
          </VisitMessage>
        </VisitPage>
      ) : !matches.length ? (
        <VisitPage>
          <EmptyState
            inset={false}
            title="No visits here yet."
            detail="Your saved visits to this place will appear here."
            visual={<EmptySymbol name="building.columns" />}
          >
            <GalleryButton label="Back to Collection" onPress={() => router.back()} />
          </EmptyState>
        </VisitPage>
      ) : (
        <FlatList
          data={matches}
          keyExtractor={(visit) => visit.localId}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ padding: 20, gap: 20 }}
          ListHeaderComponent={
            <View style={{ gap: 12 }}>
              <Text style={[Typography.pageTitle, { color: Gallery.ink }]}>
                {name || matches[0].venueName}
              </Text>
              <Text style={{ color: Gallery.muted }}>{matches[0].location}</Text>
              <View
                style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: 20 }}
              >
                <Text variant="section">Your visits</Text>
                <Text style={{ color: Gallery.muted }}>{matches.length}</Text>
              </View>
            </View>
          }
          renderItem={({ item: visit }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View visit on ${formatVisitDate(visit.visitedOn)}`}
              onPress={() =>
                router.push({ pathname: "/journal/[visitId]", params: { visitId: visit.localId } })
              }
              style={{ gap: 12 }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "600" }}>{formatVisitDate(visit.visitedOn)}</Text>
                  <Text style={{ color: Gallery.muted, fontSize: 13 }}>
                    {visit.works.length} {visit.works.length === 1 ? "artwork" : "artworks"}
                  </Text>
                </View>
                <Text style={{ color: Gallery.accent }}>View visit →</Text>
              </View>
              {visit.works[0] && (
                <SavedWorkImage
                  path={visit.works[0].cropPath}
                  title={visit.works[0].title}
                  contain
                  style={{ width: "100%", height: 220, backgroundColor: Gallery.fill }}
                />
              )}
            </Pressable>
          )}
          ListFooterComponent={
            <GalleryButton
              label="Add another visit"
              icon="plus"
              variant="outlined"
              fullWidth
              onPress={() =>
                router.push({ pathname: "/visit-create", params: { venueId: matches[0].venueId } })
              }
            />
          }
        />
      )}
    </View>
  );
}
export function VisitGlobeScreen() {
  const owner = useLocalOwner();
  return <ExpandedGlobe key={owner} />;
}
function ExpandedGlobe() {
  const [mode, setMode] = useState<"globe" | "list">("globe");
  const { venueId } = useLocalSearchParams<{ venueId?: string }>();
  const { visits, loading, error } = useVisits();
  const counts = visitCounts(visits);
  const citiesKnown = visits.every((visit) => !!visit.city);
  const places = new Set(visits.map((visit) => placeIdentity(visit).key)).size;
  return (
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button onPress={() => router.back()}>Done</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: 30 }}
      >
        {loading || error ? (
          <VisitMessage loading={loading && !error}>
            {error ? "Globe locations could not load." : "Loading globe…"}
          </VisitMessage>
        ) : (
          <>
            <View style={{ padding: 20, gap: 12 }}>
              <Text style={{ color: Gallery.muted }}>
                {counts.museums} {counts.museums === 1 ? "museum" : "museums"} · {places}{" "}
                {citiesKnown
                  ? places === 1
                    ? "city"
                    : "cities"
                  : places === 1
                    ? "place"
                    : "places"}
              </Text>
              <NativeSegmentedPicker
                compact
                label="Visit view"
                value={mode}
                onChange={setMode}
                options={[
                  { value: "globe", label: "Globe", icon: "globe" },
                  { value: "list", label: "List", icon: "list.bullet" },
                ]}
              />
            </View>
            {mode === "globe" ? (
              <VisitGlobe
                visits={visits}
                expanded
                initialVenueId={venueId}
                onList={() => setMode("list")}
              />
            ) : (
              visits.map((visit) => <VisitRow key={visit.localId} visit={visit} />)
            )}
          </>
        )}
      </ScrollView>
    </>
  );
}
