import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, TextInput, View } from "react-native";

import { LoadingRing } from "@/components/loading-ring";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { editEncounter, selectArtworkEncounters, selectArtworkPhotos } from "@/db/repos/artwork-album";
import { listVisits } from "@/db/repos/visits";
import type { SavedWork } from "@/db/schema";
import { formatVisitDate } from "@/lib/journal/history";
import { reportError } from "@/lib/observability";
import { showErrorToast, showToast } from "@/lib/ui/toast";

import { GalleryButton } from "./gallery-button";
import { NoteHeading } from "./note-editor";

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
              note: encounter.note,
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

export function ArtworkVisitNote({ work, encounter }: { work: SavedWork; encounter: Encounter }) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  function saveNote() {
    try {
      editEncounter(work.localId, encounter.visit.localId, { note }, work.owner);
      setEditing(false);
      showToast("Private note saved for this encounter.");
    } catch (cause) {
      reportError(cause, "collection.encounter.note.save");
      showErrorToast("Couldn’t save your note.", saveNote);
    }
  }
  return (
    <View style={styles.context}>
      <NoteHeading title="Note from this visit">
        {!editing && (
          <GalleryButton
            label={encounter.note ? "Edit" : "Add"}
            accessibilityLabel={encounter.note ? "Edit encounter note" : "Add an encounter note"}
            onPress={() => {
              setNote(encounter.note ?? "");
              setEditing(true);
            }}
          />
        )}
      </NoteHeading>
      {editing ? (
        <>
          <TextInput
            accessibilityLabel="Private encounter note"
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={2000}
            placeholder="Add a note about this visit…"
            placeholderTextColor={Gallery.muted}
            style={styles.input}
          />
          <View style={styles.actions}>
            <GalleryButton label="Save encounter note" onPress={saveNote} />
            <GalleryButton label="Cancel" onPress={() => setEditing(false)} />
          </View>
        </>
      ) : (
        !!encounter.note && (
          <Text selectable style={styles.note}>
            {encounter.note}
          </Text>
        )
      )}
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
      editEncounter(work.localId, current.visit.localId, { deletedAt: Date.now() }, work.owner);
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
      <NoteHeading title="Visits">
        <GalleryButton
          label="Link visit"
          icon="plus"
          onPress={() => router.push({ pathname: "/link-artwork", params: { savedId: work.localId } })}
        />
      </NoteHeading>
      {encounters.map(({ visit }) => (
        <Pressable
          key={visit.localId}
          accessibilityRole="button"
          accessibilityLabel={`View ${work.title} at ${visit.venueName}, ${formatVisitDate(visit.visitedOn)}`}
          onPress={() =>
            router.push({
              pathname: "/journal/[visitId]",
              params: { visitId: visit.localId },
            })
          }
          style={styles.visit}
        >
          <Image
            source="sf:mappin.and.ellipse"
            tintColor={Gallery.ink}
            style={{ width: 16, height: 16 }}
            accessible={false}
          />
          <Text style={styles.visitName} numberOfLines={2}>
            {visit.venueName}
          </Text>
          <Text style={styles.visitDate}>{formatVisitDate(visit.visitedOn)}</Text>
          <Image
            source="sf:chevron.right"
            tintColor={Gallery.muted}
            style={{ width: 13, height: 13 }}
            accessible={false}
          />
        </Pressable>
      ))}
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
  note: { fontSize: 17, lineHeight: 25, color: Gallery.ink, marginLeft: 24 },
  input: {
    marginLeft: 24,
    minHeight: 96,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Gallery.controlBorder,
    color: Gallery.ink,
    backgroundColor: Gallery.surface,
    fontSize: 17,
    textAlignVertical: "top",
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    marginLeft: 24,
  },
  visit: {
    minHeight: 64,
    padding: 14,
    marginBottom: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Gallery.softBorder,
    backgroundColor: Gallery.surface,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  visitName: { flex: 1, fontSize: 15, lineHeight: 20, color: Gallery.ink },
  visitDate: { fontSize: 12, lineHeight: 18, color: Gallery.muted },
});
