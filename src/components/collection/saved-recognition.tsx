import { useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Spacing } from "@/constants/theme";
import type { SavedWork } from "@/db/schema";
import { artistLine } from "@/lib/catalog/artist-line";
import {
  acceptSavedRecognition,
  identifySavedArtwork,
  savedRecognitionError,
} from "@/lib/collection/saved-recognition";
import { reportError } from "@/lib/observability";
import { showErrorToast } from "@/lib/ui/toast";

import type { SavedRecognitionResult } from "../../../convex/savedRecognition";
import { GalleryButton } from "./gallery-button";

type ObjectId = SavedRecognitionResult["candidates"][number]["objectId"];

export function SavedRecognition({
  work,
  disabled,
  onBusyChange,
  onAccepted,
}: {
  work: SavedWork;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onAccepted: () => void;
}) {
  const [result, setResult] = useState<SavedRecognitionResult>();
  const [busy, setBusy] = useState<"search" | ObjectId>();
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function run(kind: "search" | "accept", objectId?: ObjectId) {
    if (running.current || disabled) return;
    running.current = true;
    setBusy(kind === "search" ? "search" : objectId);
    onBusyChange(true);
    try {
      if (kind === "search") {
        const next = await identifySavedArtwork(work);
        if (mounted.current && next) setResult(next);
      } else if (result && objectId) {
        if ((await acceptSavedRecognition(work, result.attempt, objectId)) && mounted.current) onAccepted();
      }
    } catch (cause) {
      reportError(cause, `collection.recognition.${kind}`);
      if (mounted.current) showErrorToast(savedRecognitionError(cause), () => void run(kind, objectId));
    } finally {
      running.current = false;
      if (mounted.current) {
        setBusy(undefined);
        onBusyChange(false);
      }
    }
  }

  return (
    <View style={{ gap: Spacing.two }}>
      <GalleryButton
        label="Try identifying again"
        icon="viewfinder"
        variant="outlined"
        fullWidth
        disabled={disabled || !!busy}
        busy={busy === "search"}
        busyLabel="Looking for a match…"
        onPress={() => {
          void run("search");
        }}
      />
      {result && (
        <View style={{ gap: Spacing.two }}>
          <Text accessibilityRole="header" variant="section">
            {result.candidates.length > 0 ? "Possible matches" : "No match found yet"}
          </Text>
          {result.candidates.length === 0 && (
            <Text themeColor="textSecondary">Your photo is saved. Try again as more artworks are added.</Text>
          )}
          {result.candidates.map((candidate) => (
            <View
              key={candidate.objectId}
              style={{
                paddingVertical: Spacing.two,
                gap: Spacing.two,
                borderBottomWidth: 1,
                borderColor: Gallery.separator,
              }}
            >
              <Text>{candidate.title}</Text>
              <Text themeColor="textSecondary">{artistLine(candidate.artist, candidate.date)}</Text>
              <GalleryButton
                label="Use this match"
                accessibilityLabel={`Use this match: ${candidate.title}, ${candidate.artist}`}
                disabled={disabled || !!busy}
                busy={busy === candidate.objectId}
                busyLabel="Saving identification…"
                onPress={() => {
                  void run("accept", candidate.objectId);
                }}
              />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
