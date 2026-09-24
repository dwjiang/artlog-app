import { reportError } from "@/lib/observability";
import { SavedWorkImage } from "./saved-work-image";
import { LoadingRing } from "@/components/loading-ring";
import { ListSkeleton } from "@/components/loading-skeleton";
import { ThemedText as Text } from "@/components/themed-text";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, ScrollView, TextInput, View } from "react-native";
import { api } from "../../../convex/_generated/api";
import { Gallery } from "@/constants/theme";
import { applyAlbum } from "@/db/repos/artwork-album";
import { editSavedWork, listSavedWorks, selectSavedWork, upsertFromRemote } from "@/db/repos/saved-works";
import type { SavedWork } from "@/db/schema";
import { captureOwner, useLocalOwner } from "@/lib/account/owner-store";
import { flushCollectionMedia } from "@/lib/account/collection-sync";
import { convex } from "@/lib/convex-client";
import { removeUnreferencedPhotos } from "@/lib/files/unreferenced-photos";
import { GalleryButton } from "./gallery-button";
import { ArtworkQueryState } from "./artwork-query-state";

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
  const [title, setTitle] = useState(work.title === "Unidentified artwork" ? "" : work.title),
    [artist, setArtist] = useState(work.artist);
  const [focusedField, setFocusedField] = useState<string>();
  const [date, setDate] = useState(work.date ?? ""),
    [medium, setMedium] = useState(work.medium ?? "");
  const [search, setSearch] = useState(""),
    [choosing, setChoosing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
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
    setBusy(true);
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
      router.replace({
        pathname: "/saved/[savedId]",
        params: { savedId: target.localId },
      });
    } catch (cause) {
      reportError(cause, "collection.artwork.merge");
      setError(
        "Could not merge these artworks. Check your connection. Albums over 100 photos or very long combined notes need editing first.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: Gallery.paper }}
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={{ padding: 20, gap: 18 }}
    >
      <SavedWorkImage
        path={work.cropPath}
        title={work.title}
        contain
        style={{ width: "100%", height: 160, backgroundColor: Gallery.fill }}
      />
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
            <Text style={{ color: Gallery.ink }}>Find saved artwork</Text>
            <TextInput
              accessibilityLabel="Find saved artwork"
              placeholder="Search your collection"
              placeholderTextColor={Gallery.muted}
              keyboardAppearance="light"
              selectionColor={Gallery.accent}
              value={search}
              onChangeText={setSearch}
              editable={!busy}
              style={{
                padding: 16,
                backgroundColor: Gallery.surface,
                color: Gallery.ink,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: Gallery.controlBorder,
              }}
            />
            {works.error ? (
              <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>
                Couldn’t load your collection. Close and reopen this artwork to try again.
              </Text>
            ) : !works.updatedAt && !matches.length ? (
              <ListSkeleton label="Loading artworks…" rows={3} />
            ) : !matches.length ? (
              <Text style={{ color: Gallery.muted }}>
                {search ? "No matching artworks. Try another title or artist." : "No other saved artworks to combine."}
              </Text>
            ) : null}
            {matches.map((target) => (
              <GalleryButton
                key={target.localId}
                label={`${target.title} · ${target.artist}`}
                disabled={busy}
                onPress={() =>
                  Alert.alert(
                    "Combine these artworks?",
                    `Move all photos, visit links, and private notes into “${target.title}”. The duplicate artwork and its shared placements will be removed.`,
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Combine artworks",
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
        {busy && <LoadingRing accessibilityLabel="Combining artworks…" />}
      </View>
      <GalleryButton
        label="Save details"
        variant="filled"
        fullWidth
        disabled={busy}
        onPress={() => {
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
            router.back();
          } catch (cause) {
            reportError(cause, "collection.artwork.update");
            setError("Your artwork details could not be saved. Your edits are still here. Try again.");
          }
        }}
      />
      {error && (
        <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>
          {error}
        </Text>
      )}
    </ScrollView>
  );
}
