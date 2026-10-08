import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { router } from "expo-router";
import { useEffect, type ReactNode } from "react";
import { Alert, StyleSheet, View, useWindowDimensions } from "react-native";

import { ListIcon, ListRow, ListSection } from "@/components/list-row";
import { LoadingRing } from "@/components/loading-ring";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { selectArtworkEncounters, selectArtworkPhotos, unlinkArtworkVisit } from "@/db/repos/artwork-album";
import { listVisits } from "@/db/repos/visits";
import type { SavedWork } from "@/db/schema";
import { formatVisitDate } from "@/lib/journal/history";
import { reportError } from "@/lib/observability";
import { showErrorToast } from "@/lib/ui/toast";

import { GalleryButton } from "./gallery-button";

export function useArtworkEncounters(work: SavedWork) {
  const encounters = useLiveQuery(selectArtworkEncounters(work.owner), [work.owner]);
  const visits = useLiveQuery(listVisits(work.owner), [work.owner]);
  const photos = useLiveQuery(selectArtworkPhotos(work.localId, work.owner), [work.localId, work.owner]);
  const queryError = encounters.error ?? visits.error ?? photos.error;
  useEffect(() => {
    if (queryError) reportError(queryError, "collection.encounters.load");
  }, [queryError]);
  const rows = visits.data
    .filter((visit) => visit.owner === work.owner)
    .flatMap((visit) => {
      const encounter = encounters.data.find(
        (row) =>
          row.owner === work.owner
          && row.savedLocalId === work.localId
          && row.visitLocalId === visit.localId
          && row.deletedAt === null,
      );
      return encounter
        ? [
            {
              visit,
              photoCount: photos.data.filter(
                (photo) =>
                  photo.owner === work.owner
                  && photo.savedLocalId === work.localId
                  && photo.visitLocalId === visit.localId,
              ).length,
            },
          ]
        : [];
    });
  return {
    encounters: rows,
    loading: !visits.updatedAt || !encounters.updatedAt,
    error: visits.error ?? encounters.error,
  };
}

type Encounter = ReturnType<typeof useArtworkEncounters>["encounters"][number];

function SectionHeading({ title, children }: { title: string; children?: ReactNode }) {
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= 1.5;
  return (
    <View style={[styles.heading, stacked && styles.stacked]}>
      <Text accessibilityRole="header" style={[styles.title, stacked && { flex: 0 }]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

/** One row per visit the artwork was seen on, each opening that visit in the journal. */
export function ArtworkEncounterList({
  work,
  encounters,
  visitId,
  loading,
  loadError,
}: {
  work: SavedWork;
  encounters: Encounter[];
  visitId?: string;
  loading?: boolean;
  loadError?: Error;
}) {
  const current = encounters.find(({ visit }) => visit.localId === visitId);
  function unlink() {
    if (!current) return;
    try {
      unlinkArtworkVisit(work.localId, current.visit.localId, work.owner);
      router.replace({
        pathname: "/saved/[savedId]",
        params: { savedId: work.localId },
      });
    } catch (cause) {
      reportError(cause, "collection.encounter.unlink");
      showErrorToast("Couldn’t unlink this visit.", unlink);
    }
  }
  return (
    <View style={styles.context}>
      <SectionHeading title="Visits">
        <GalleryButton
          label="Link visit"
          icon="plus"
          onPress={() => router.push({ pathname: "/link-artwork", params: { savedId: work.localId } })}
        />
      </SectionHeading>
      {encounters.length > 0 && (
        <ListSection outlined>
          {encounters.map(({ visit }, index) => (
            <ListRow
              key={visit.localId}
              title={visit.venueName}
              subtitle={formatVisitDate(visit.visitedOn)}
              leading={<ListIcon name="mappin.and.ellipse" />}
              accessibilityLabel={`View ${work.title} at ${visit.venueName}, ${formatVisitDate(visit.visitedOn)}`}
              accessory="chevron"
              first={index === 0}
              last={index === encounters.length - 1}
              onPress={() =>
                router.push({
                  pathname: "/journal/[visitId]",
                  params: { visitId: visit.localId },
                })
              }
            />
          ))}
        </ListSection>
      )}
      {encounters.length === 0
        && (loadError ? (
          <Text accessibilityRole="alert" style={styles.caption}>
            Visits couldn’t load. Close and reopen this artwork to try again.
          </Text>
        ) : loading ? (
          <LoadingRing accessibilityLabel="Loading artwork visits…" />
        ) : (
          <Text style={styles.caption}>No linked visits.</Text>
        ))}
      {current && (
        <GalleryButton
          label="Unlink from this visit"
          onPress={() =>
            Alert.alert("Unlink this visit?", "Your artwork, photos, and visit stay in your journal.", [
              { text: "Cancel", style: "cancel" },
              {
                text: "Unlink",
                onPress: unlink,
              },
            ])
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  context: { gap: 8 },
  caption: { fontSize: 13, lineHeight: 18, color: Gallery.muted },
  heading: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  stacked: { flexDirection: "column", alignItems: "stretch" },
  title: { flex: 1, fontSize: 16, fontWeight: "600", lineHeight: 22, color: Gallery.ink },
});
