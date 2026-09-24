import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState, SearchEmptyState } from "@/components/empty-state";
import { ArtworkCollage } from "@/components/guest/artwork-preview";
import { VisitKeepsake } from "@/components/guest/visit-keepsake";
import { ListSkeleton } from "@/components/loading-skeleton";
import { SocialState } from "@/components/social/social-state";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { linkArtworkVisits, linkArtworksVisit, selectArtworkEncounters } from "@/db/repos/artwork-album";
import { listSavedWorks } from "@/db/repos/saved-works";
import { listVisits } from "@/db/repos/visits";
import { useLocalOwner } from "@/lib/account/owner-store";
import { cropSyncing } from "@/lib/account/photo-sync";
import { formatVisitDate } from "@/lib/journal/history";
import { reportError } from "@/lib/observability";
import { showToast } from "@/lib/ui/toast";
import { normalizeSearch } from "@/shared/journal/limits";

import { CollectionSearchField } from "./collection-search-field";
import { GalleryButton } from "./gallery-button";
import { SavedWorkImage } from "./saved-work-image";

export function LinkArtworkScreen() {
  const { savedId, visitId } = useLocalSearchParams<{
    savedId?: string;
    visitId?: string;
  }>();
  const owner = useLocalOwner();
  const [attempt, setAttempt] = useState(0);
  return (
    <LinkPicker
      key={`${owner}:${savedId ?? ""}:${visitId ?? ""}:${attempt}`}
      owner={owner}
      savedId={savedId}
      visitId={visitId}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}

function LinkPicker({
  owner,
  savedId,
  visitId,
  onRetry,
}: {
  owner: string;
  savedId?: string;
  visitId?: string;
  onRetry: () => void;
}) {
  const works = useLiveQuery(listSavedWorks(owner), [owner]);
  const visits = useLiveQuery(listVisits(owner), [owner]);
  const encounters = useLiveQuery(selectArtworkEncounters(owner), [owner]);
  const queryError = works.error ?? visits.error ?? encounters.error;
  useEffect(() => {
    if (queryError) reportError(queryError, "collection.link-options.load");
  }, [queryError]);
  const [error, setError] = useState<string>();
  const [search, setSearch] = useState("");
  const { bottom } = useSafeAreaInsets();
  const [selected, setSelected] = useState<string[]>([]);
  const destination = visits.data.find((visit) => visit.localId === visitId && visit.owner === owner);
  const clearSearch = () => setSearch("");
  const rows = savedId
    ? visits.data
        .filter((row) => row.owner === owner)
        .map((row) => ({
          id: row.localId,
          title: row.venueName,
          subtitle: formatVisitDate(row.visitedOn),
          path: null,
          syncing: false,
        }))
    : works.data
        .filter((row) => row.owner === owner)
        .map((row) => ({
          id: row.localId,
          title: row.title,
          subtitle: row.artist,
          path: row.cropPath,
          syncing: cropSyncing(row),
        }));
  const filtered = rows.filter((row) =>
    normalizeSearch(`${row.title} ${row.subtitle}`).includes(normalizeSearch(search)),
  );
  const query = savedId ? visits : works;
  const noun = savedId ? (selected.length === 1 ? "visit" : "visits") : selected.length === 1 ? "artwork" : "artworks";
  if (!!savedId === !!visitId) {
    return (
      <View style={{ flex: 1, backgroundColor: Gallery.paper }}>
        <SocialState
          title="Link unavailable."
          detail="Open an artwork or visit before linking."
          action="Go back"
          onAction={() => router.back()}
        />
      </View>
    );
  }
  return (
    <>
      <Stack.Screen options={{ title: savedId ? "Link a visit" : "Link artworks" }} />
      <FlatList
        style={{ backgroundColor: Gallery.paper }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
        data={filtered}
        keyExtractor={(row) => row.id}
        ListHeaderComponent={
          <View style={{ gap: 10, paddingVertical: 14 }}>
            {!savedId && (
              <Text style={{ color: Gallery.muted }}>
                {destination
                  ? `${destination.venueName} · ${formatVisitDate(destination.visitedOn)}`
                  : "Opening visit…"}
              </Text>
            )}
            {rows.length > 0 && (
              <CollectionSearchField
                value={search}
                label={savedId ? "Search visits" : "Search artworks"}
                showLabel={false}
                filled
                onChange={setSearch}
                onClear={clearSearch}
              />
            )}
            {rows.length > 0 && (
              <Text style={{ color: Gallery.muted, fontSize: 13, lineHeight: 20 }}>
                Keep the artwork and its photos together across visits. Linking doesn’t copy or share photos.
              </Text>
            )}
            {savedId && rows.length > 0 && (
              <GalleryButton
                label="Add a new visit"
                icon="plus"
                onPress={() =>
                  router.push({
                    pathname: "/visit-create",
                    params: { savedId },
                  })
                }
              />
            )}
            {error && (
              <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>
                {error}
              </Text>
            )}
          </View>
        }
        renderItem={({ item: row }) => {
          const work = savedId ?? row.id;
          const visit = visitId ?? row.id;
          const linked = encounters.data.some(
            (entry) => entry.owner === owner && entry.savedLocalId === work && entry.visitLocalId === visit,
          );
          return (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{
                checked: linked || selected.includes(row.id),
                disabled: linked,
              }}
              accessibilityLabel={`${linked ? "Linked: " : "Select "}${row.title}`}
              disabled={linked}
              onPress={() => {
                setSelected((ids) => (ids.includes(row.id) ? ids.filter((id) => id !== row.id) : [...ids, row.id]));
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingVertical: 16,
                borderBottomWidth: 1,
                borderColor: Gallery.separator,
              }}
            >
              {!savedId && (
                <SavedWorkImage
                  path={row.path}
                  syncing={row.syncing}
                  title={row.title}
                  contain
                  style={{ width: 56, height: 56, borderRadius: 2 }}
                />
              )}
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ fontSize: 17, lineHeight: 25, color: Gallery.ink }}>{row.title}</Text>
                <Text style={{ fontSize: 13, color: Gallery.muted }}>
                  {row.subtitle}
                  {linked ? " · Linked" : ""}
                </Text>
              </View>
              <Text style={{ color: Gallery.muted }}>{linked || selected.includes(row.id) ? "✓" : "○"}</Text>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          query.error || encounters.error ? (
            <SocialState title="Couldn’t load your collection." action="Try again" onAction={onRetry} />
          ) : !query.updatedAt && rows.length === 0 ? (
            <ListSkeleton label={savedId ? "Loading visits…" : "Loading artworks…"} />
          ) : search.trim() ? (
            <SearchEmptyState
              title="No matches."
              detail={savedId ? "Try a museum or visit date." : "Try another title or artist."}
              onClear={clearSearch}
            />
          ) : (
            <EmptyState
              inset={false}
              title={savedId ? "No visits to link." : "No artworks to link."}
              detail={
                savedId
                  ? "Add a museum visit, then link this artwork to it."
                  : "Scan an artwork to save it to this visit."
              }
              visual={savedId ? <VisitKeepsake /> : <ArtworkCollage />}
            >
              <GalleryButton
                label={savedId ? "Add visit" : "Scan artwork"}
                variant="filled"
                fullWidth
                onPress={() => {
                  if (savedId) {
                    router.push({
                      pathname: "/visit-create",
                      params: { savedId },
                    });
                  } else {
                    router.dismissAll();
                    router.navigate({ pathname: "/scan", params: { visitId } });
                  }
                }}
              />
              <GalleryButton label="Not now" fullWidth onPress={() => router.back()} />
            </EmptyState>
          )
        }
      />
      {rows.length > 0 && (
        <View
          style={{
            padding: 20,
            paddingBottom: Math.max(bottom, 20),
            backgroundColor: Gallery.paper,
          }}
        >
          <GalleryButton
            label={`Link ${selected.length > 0 ? selected.length : ""} ${noun}`.replace("  ", " ")}
            variant="filled"
            fullWidth
            disabled={selected.length === 0}
            onPress={() => {
              try {
                if (visitId) linkArtworksVisit(selected, visitId, owner);
                else linkArtworkVisits(savedId!, selected, owner);
                showToast(`${selected.length} ${noun} linked.`);
                if (visitId) {
                  router.dismissTo({
                    pathname: "/journal/[visitId]",
                    params: { visitId },
                  });
                } else {
                  router.dismissTo({
                    pathname: "/saved/[savedId]",
                    params: { savedId: savedId! },
                  });
                }
              } catch (cause) {
                reportError(cause, "collection.visit.link");
                setError("Could not link your selection. Try again.");
              }
            }}
          />
        </View>
      )}
    </>
  );
}
