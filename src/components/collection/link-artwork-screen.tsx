import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionStack } from "@/components/action-stack";
import { EmptyState, SearchEmptyState } from "@/components/empty-state";
import { EmptyFrames, EmptyTicket } from "@/components/empty-state-art";
import { ListRow } from "@/components/list-row";
import { ListSkeleton } from "@/components/loading-skeleton";
import { SearchField } from "@/components/search-field";
import { SocialState, StateScreen } from "@/components/social/social-state";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, PinnedFooterBorder, Radius, Spacing } from "@/constants/theme";
import { linkArtworkVisits, linkArtworksVisit, selectArtworkEncounters } from "@/db/repos/artwork-album";
import { listSavedWorks } from "@/db/repos/saved-works";
import { listVisits } from "@/db/repos/visits";
import { useLocalOwner } from "@/lib/account/owner-store";
import { cropSyncing } from "@/lib/account/photo-sync";
import { formatVisitDate } from "@/lib/journal/history";
import { reportError } from "@/lib/observability";
import { showErrorToast, showToast } from "@/lib/ui/toast";
import { normalizeSearch } from "@/shared/journal/limits";

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
  function linkSelection(ids: string[]) {
    try {
      if (visitId) linkArtworksVisit(ids, visitId, owner);
      else linkArtworkVisits(savedId!, ids, owner);
      const linkedNoun = savedId ? (ids.length === 1 ? "visit" : "visits") : ids.length === 1 ? "artwork" : "artworks";
      showToast(`${ids.length} ${linkedNoun} linked.`);
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
      showErrorToast("Couldn’t link your selection.", () => linkSelection(ids));
    }
  }
  if (!!savedId === !!visitId) {
    return (
      <StateScreen grouped>
        <SocialState
          title="Link unavailable."
          detail="Open an artwork or visit before linking."
          action="Go back"
          onAction={() => router.back()}
        />
      </StateScreen>
    );
  }
  return (
    <>
      <Stack.Screen options={{ title: savedId ? "Link a Visit" : "Link Artworks" }} />
      <FlatList
        style={{ backgroundColor: Gallery.groupedBackground }}
        contentInsetAdjustmentBehavior="automatic"
        bounces={filtered.length > 0}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: Spacing.content, paddingBottom: filtered.length > 0 ? 32 : 0 }}
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
              <SearchField
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
                Linking doesn’t copy or share photos.
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
          </View>
        }
        renderItem={({ item: row, index }) => {
          const work = savedId ?? row.id;
          const visit = visitId ?? row.id;
          const linked = encounters.data.some(
            (entry) => entry.owner === owner && entry.savedLocalId === work && entry.visitLocalId === visit,
          );
          return (
            <ListRow
              title={row.title}
              query={search}
              subtitle={linked ? `${row.subtitle} · Linked` : row.subtitle}
              leading={
                !savedId && (
                  <SavedWorkImage
                    path={row.path}
                    syncing={row.syncing}
                    title={row.title}
                    contain
                    style={{ width: 56, height: 56, borderRadius: Radius.thumbnail }}
                  />
                )
              }
              accessibilityRole="checkbox"
              accessibilityLabel={`${linked ? "Linked: " : "Select "}${row.title}`}
              accessory="toggle"
              selected={linked || selected.includes(row.id)}
              disabled={linked}
              first={index === 0}
              last={index === filtered.length - 1}
              onPress={() => {
                setSelected((ids) => (ids.includes(row.id) ? ids.filter((id) => id !== row.id) : [...ids, row.id]));
              }}
            />
          );
        }}
        ListEmptyComponent={
          query.error || encounters.error ? (
            <SocialState title="Couldn’t load your collection." action="Try again" onAction={onRetry} />
          ) : !query.updatedAt && rows.length === 0 ? (
            <ListSkeleton label={savedId ? "Loading visits…" : "Loading artworks…"} card />
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
              visual={savedId ? <EmptyTicket /> : <EmptyFrames />}
            >
              <ActionStack textActions={<GalleryButton label="Not Now" fullWidth onPress={() => router.back()} />}>
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
              </ActionStack>
            </EmptyState>
          )
        }
      />
      {rows.length > 0 && (
        <View
          style={{
            padding: 20,
            paddingBottom: Math.max(bottom, 20),
            backgroundColor: Gallery.groupedBackground,
            ...PinnedFooterBorder,
          }}
        >
          <GalleryButton
            label={`Link ${selected.length > 0 ? selected.length : ""} ${noun}`.replace("  ", " ")}
            variant="filled"
            fullWidth
            disabled={selected.length === 0}
            onPress={() => linkSelection(selected)}
          />
        </View>
      )}
    </>
  );
}
