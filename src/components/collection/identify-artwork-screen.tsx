import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, TextInput, View } from "react-native";

import { ListSkeleton } from "@/components/loading-skeleton";
import { SafeAreaScrollView } from "@/components/safe-area-scroll";
import { SearchField } from "@/components/search-field";
import { CommitToolbar } from "@/components/sheet-controls";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { applyAlbum } from "@/db/repos/artwork-album";
import { editSavedWork, listSavedWorks, selectSavedWork, upsertFromRemote } from "@/db/repos/saved-works";
import type { SavedWork } from "@/db/schema";
import { useDiscardEditsGuard } from "@/hooks/use-discard-edits-guard";
import { flushCollectionMedia } from "@/lib/account/collection-sync";
import { captureOwner, useLocalOwner } from "@/lib/account/owner-store";
import { convex } from "@/lib/convex-client";
import { removeUnreferencedPhotos } from "@/lib/files/unreferenced-photos";
import { reportError } from "@/lib/observability";

import { api } from "../../../convex/_generated/api";
import { ArtworkQueryState } from "./artwork-query-state";
import { GalleryButton } from "./gallery-button";
import { SavedRecognition } from "./saved-recognition";
import { SavedWorkImage } from "./saved-work-image";

export function IdentifyArtworkScreen() {
  const { savedId } = useLocalSearchParams<{ savedId: string }>();
  const owner = useLocalOwner();
  const [attempt, setAttempt] = useState(0);
  return (
    <ArtworkQuery
      key={`${owner}:${savedId}:${attempt}`}
      owner={owner}
      savedId={savedId}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}
function ArtworkQuery({ owner, savedId, onRetry }: { owner: string; savedId: string; onRetry: () => void }) {
  const { data, error, updatedAt } = useLiveQuery(selectSavedWork(savedId, owner), [savedId, owner]);
  useEffect(() => {
    if (error) reportError(error, "collection.artwork.load");
  }, [error]);
  const work = data.find((row) => row.owner === owner && row.localId === savedId && row.deletedAt === null);
  return work ? (
    <Editor key={`${owner}:${savedId}`} work={work} />
  ) : (
    <ArtworkQueryState item="Artwork" loading={!updatedAt} error={error} onRetry={onRetry} />
  );
}
function Editor({ work }: { work: SavedWork }) {
  const [initial] = useState({
    title: work.title === "Unidentified artwork" ? "" : work.title,
    artist: work.artist,
    date: work.date ?? "",
    medium: work.medium ?? "",
  });
  const [title, setTitle] = useState(initial.title);
  const [artist, setArtist] = useState(initial.artist);
  const [focusedField, setFocusedField] = useState<string>();
  const [date, setDate] = useState(initial.date);
  const [medium, setMedium] = useState(initial.medium);
  // Merging or using a match replaces these details, so those leave without asking too.
  const leave = useDiscardEditsGuard({
    edited: title !== initial.title || artist !== initial.artist || date !== initial.date || medium !== initial.medium,
  });
  const [search, setSearch] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [mergingInto, setMergingInto] = useState<string>();
  const [error, setError] = useState<string>();
  const [recognizing, setRecognizing] = useState(false);
  const merging = mergingInto !== undefined;
  const busy = merging || recognizing;
  const works = useLiveQuery(listSavedWorks(work.owner), [work.owner]);
  useEffect(() => {
    if (works.error) {
      reportError(works.error, "collection.merge-destinations.load");
    }
  }, [works.error]);
  const matches = works.data.filter(
    (target) =>
      target.owner === work.owner
      && target.localId !== work.localId
      && target.deletedAt === null
      && `${target.title} ${target.artist}`.toLowerCase().includes(search.toLowerCase()),
  );
  async function merge(target: SavedWork) {
    const session = captureOwner();
    if (!session.scope) {
      setError("Connect to the internet to merge artworks.");
      return;
    }
    setMergingInto(target.localId);
    setError(undefined);
    try {
      await flushCollectionMedia({
        saveLocalIds: [work.localId, target.localId],
      });
      if (!session.isCurrent()) return;
      const result = await convex.mutation(api.artworkAlbums.merge, {
        scope: session.scope,
        sourceLocalId: work.localId,
        targetLocalId: target.localId,
      });
      if (!session.isCurrent()) return;
      await removeUnreferencedPhotos(await upsertFromRemote(result.saves, session.owner));
      applyAlbum(result.photos, result.encounters, session.owner);
      leave(() =>
        router.replace({
          pathname: "/saved/[savedId]",
          params: { savedId: target.localId },
        }),
      );
    } catch (cause) {
      reportError(cause, "collection.artwork.merge");
      setError("Could not merge these artworks. Check your connection. Albums over 100 photos need editing first.");
    } finally {
      setMergingInto(undefined);
    }
  }
  const save = () => {
    try {
      editSavedWork(
        work.localId,
        {
          title: title.trim() || "Unidentified artwork",
          artist: artist.trim(),
          date: date.trim() || null,
          medium: medium.trim() || null,
        },
        work.owner,
      );
      leave();
    } catch (cause) {
      reportError(cause, "collection.artwork.update");
      setError("Your artwork details could not be saved. Your edits are still here. Try again.");
    }
  };
  return (
    <>
      <CommitToolbar label="Save" disabled={busy} onPress={save} />
      <SafeAreaScrollView
        style={{ flex: 1, backgroundColor: Gallery.paper }}
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ padding: 20, gap: 18 }}
      >
        <SavedWorkImage path={work.cropPath} title={work.title} contain style={{ width: "100%", height: 160 }} />
        <SavedRecognition work={work} disabled={merging} onBusyChange={setRecognizing} onAccepted={() => leave()} />
        <Text variant="section" accessibilityRole="header">
          Artwork details
        </Text>
        {[
          { label: "Title", value: title, change: setTitle },
          { label: "Artist", value: artist, change: setArtist },
          { label: "Date", value: date, change: setDate },
          { label: "Medium", value: medium, change: setMedium },
        ].map((field) => (
          <View key={field.label} style={{ gap: 8 }}>
            <Text style={{ color: Gallery.ink, fontSize: 15 }}>{field.label}</Text>
            <TextInput
              accessibilityLabel={field.label}
              value={field.value}
              onChangeText={field.change}
              onFocus={() => setFocusedField(field.label)}
              onBlur={() => setFocusedField(undefined)}
              maxLength={500}
              editable={!busy}
              selectionColor={Gallery.accent}
              keyboardAppearance="light"
              style={{
                backgroundColor: Gallery.surface,
                color: Gallery.ink,
                fontSize: 17,
                padding: 16,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: focusedField === field.label ? Gallery.accent : Gallery.controlBorder,
              }}
            />
          </View>
        ))}
        <View
          style={{
            borderTopWidth: 1,
            borderColor: Gallery.separator,
            paddingTop: 24,
            gap: 8,
          }}
        >
          <GalleryButton
            label="This is an artwork I already saved"
            disabled={busy}
            onPress={() => setChoosing(!choosing)}
          />
          {choosing && (
            <View style={{ gap: 12 }}>
              <SearchField
                label="Find saved artwork"
                placeholder="Search your collection"
                value={search}
                editable={!busy}
                onChange={setSearch}
                onClear={() => setSearch("")}
              />
              {works.error ? (
                <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>
                  Couldn’t load your collection. Close and reopen this artwork to try again.
                </Text>
              ) : !works.updatedAt && matches.length === 0 ? (
                <ListSkeleton label="Loading artworks…" rows={3} />
              ) : matches.length === 0 ? (
                <Text style={{ color: Gallery.muted }}>
                  {search
                    ? "No matching artworks. Try another title or artist."
                    : "No other saved artworks to combine."}
                </Text>
              ) : null}
              {matches.map((target) => (
                <GalleryButton
                  key={target.localId}
                  label={`${target.title} · ${target.artist}`}
                  maskInReplay
                  busy={mergingInto === target.localId}
                  busyLabel="Combining artworks…"
                  disabled={busy}
                  onPress={() =>
                    Alert.alert(
                      "Combine these artworks?",
                      `Move all photos and visit links into “${target.title}”. The duplicate artwork and its shared placements will be removed.`,
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Combine Artworks",
                          onPress: () => {
                            void merge(target);
                          },
                        },
                      ],
                    )
                  }
                />
              ))}
            </View>
          )}
        </View>
        {error && (
          <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>
            {error}
          </Text>
        )}
      </SafeAreaScrollView>
    </>
  );
}
