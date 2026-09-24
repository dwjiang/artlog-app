import { Image } from "expo-image";
import { Stack } from "expo-router";
import { useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ListenActions } from "@/components/audio/listen-actions";
import { GalleryButton } from "@/components/collection/gallery-button";
import { HighlightHeading } from "@/components/highlight-heading";
import { useCapturePhotos } from "@/components/scan/capture-photos-button";
import { ThemedText } from "@/components/themed-text";
import { Gallery, Spacing } from "@/constants/theme";
import { captureFileUri, scanPreviewPath } from "@/lib/files/photos";
import type { SaveResultInput } from "@/lib/result/save";
import { canSave, draftFromCandidate, type SnapshotDraft } from "@/lib/result/snapshot";
import type { ResultCandidate, ResultViewState } from "@/lib/result/state";

import { DocentSection } from "./docent-section";
import { FieldsForm } from "./fields-form";
import { RightNowSection } from "./right-now-section";
import { RunnerUps } from "./runner-ups";
import { SaveBar } from "./save-bar";
import { TentativeOriginNotice } from "./tentative-origin-notice";

type ResultCardProps = {
  manual?: boolean;
  prosePending?: boolean;
  captureInput?: Omit<SaveResultInput, "draft">;
  view: ResultViewState;
  saving: boolean;
  savedId?: string;
  saveError?: string;
  header: ReactNode;
  context?: ReactNode;
  search?: ReactNode;
  visit?: ReactNode;
  onLabel: () => void;
  onSearchMuseum?: () => void;
  onPick: (candidate: ResultCandidate) => void;
  onEdit: () => void;
  onSave: (draft: SnapshotDraft) => void;
  onSavePhoto: () => void;
  savePhotoOnly: boolean;
  onViewSaved: () => void;
};

/** Keyed by the named work, so a new primary resets the draft while streamed prose leaves edits alone. */
export function ResultCard({
  manual = false,
  prosePending = true,
  captureInput,
  view,
  saving,
  savedId,
  saveError,
  header,
  context,
  search,
  visit,
  onLabel,
  onSearchMuseum,
  onPick,
  onEdit,
  onSave,
  onSavePhoto,
  savePhotoOnly,
  onViewSaved,
}: ResultCardProps) {
  const [draft, setDraft] = useState(() => draftFromCandidate(view.primary));
  const [editingDetails, setEditingDetails] = useState(manual);
  const { bottom } = useSafeAreaInsets();
  const editable = !saving && !savedId;
  const suggestions = editable && view.kind !== "confident" ? view.runnerUps : [];
  const photos = useCapturePhotos(
    captureInput
      ? {
          ...captureInput,
          view: savePhotoOnly ? undefined : captureInput.view,
          draft: savePhotoOnly ? draftFromCandidate() : draft,
        }
      : undefined,
    !editable,
  );
  return (
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu
          icon="ellipsis"
          accessibilityLabel="Scan options"
          tintColor={Gallery.ink}
          hidesSharedBackground
        >
          <Stack.Toolbar.MenuAction disabled={!editable} onPress={() => setEditingDetails((value) => !value)}>
            {editingDetails ? "Done editing" : "Edit details"}
          </Stack.Toolbar.MenuAction>
          {view.kind === "confident" && (
            <Stack.Toolbar.MenuAction disabled={!editable} onPress={onLabel}>
              Scan the label
            </Stack.Toolbar.MenuAction>
          )}
          <Stack.Toolbar.MenuAction disabled={photos.unavailable} onPress={photos.open}>
            {photos.label}
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        contentContainerStyle={styles.content}
      >
        {header}
        <View style={styles.identity}>
          <ThemedText type="title" style={{ fontSize: 36, lineHeight: 42 }}>
            {view.kind === "soft" ? `Could this be ${draft.title}?` : draft.title || "Unidentified artwork"}
          </ThemedText>
          {!editingDetails && (
            <>
              {view.kind !== "soft" && (
                <ThemedText style={styles.workTitle}>
                  {draft.artist}
                  {draft.date ? ` · ${draft.date}` : ""}
                </ThemedText>
              )}
              {view.kind === "confident" && !!draft.medium && (
                <ThemedText variant="metadata" themeColor="textSecondary">
                  {draft.medium}
                </ThemedText>
              )}
              {view.kind === "confident" && !!draft.institution && (
                <View style={styles.museum}>
                  <Image
                    source="sf:building.columns"
                    tintColor={Gallery.muted}
                    style={styles.museumIcon}
                    accessible={false}
                  />
                  <ThemedText variant="metadata" themeColor="textSecondary" style={{ flexShrink: 1 }}>
                    {draft.institution}
                  </ThemedText>
                </View>
              )}
            </>
          )}
        </View>
        {view.kind === "confident" && view.primary && (
          <ListenActions
            artworkId={view.primary.artworkId}
            title={draft.title}
            artist={draft.artist}
            scanId={captureInput?.scanId}
            savedId={savedId}
            imageUri={
              captureInput?.capture ? captureFileUri(scanPreviewPath(captureInput.capture.cropPath)) : undefined
            }
          />
        )}
        {!view.primary && !editingDetails && (
          <ThemedText themeColor="textSecondary">
            We couldn’t identify this artwork yet. Keep the photo and add what you know.
          </ThemedText>
        )}
        {view.kind === "soft" && (
          <>
            <ThemedText themeColor="textSecondary">
              The image looks similar, but we’re not sure. Scan the museum label to confirm the details.
            </ThemedText>
            <ThemedText variant="metadata" themeColor="textSecondary">
              Possible artist · {draft.artist || "Unknown"}
            </ThemedText>
          </>
        )}
        {view.primary?.identityStatus === "tentative" && <TentativeOriginNotice />}
        {!editingDetails && view.kind === "unidentified" && (
          <View
            style={{
              borderWidth: 0.5,
              borderColor: Gallery.separator,
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            {onSearchMuseum && (
              <GalleryButton
                label="Search museum collection"
                icon="magnifyingglass"
                fullWidth
                disabled={!editable}
                onPress={onSearchMuseum}
              />
            )}
            <GalleryButton
              label="Enter details myself"
              icon="pencil"
              fullWidth
              disabled={!editable}
              onPress={() => setEditingDetails(true)}
            />
          </View>
        )}
        {editingDetails && (
          <FieldsForm
            draft={draft}
            editable={editable}
            onChange={(field, value) => {
              onEdit();
              setDraft((current) => ({ ...current, [field]: value }));
            }}
          />
        )}
        {suggestions.length > 0 && (
          <View style={styles.section}>
            <HighlightHeading>Other possibilities</HighlightHeading>
            <RunnerUps candidates={suggestions} onPick={onPick} />
          </View>
        )}
        {view.kind !== "confident" && context}
        {view.kind === "confident" && (
          <>
            <DocentSection
              title="About this work"
              docent={view.docent}
              factSheet={view.factSheet}
              pending={prosePending && !view.docent?.length}
            />
            <RightNowSection rightNow={view.rightNow} />
            {context}
          </>
        )}
        {search}
      </ScrollView>
      <View style={[styles.save, { paddingBottom: Math.max(12, bottom) }]}>
        <SaveBar
          canSave={savePhotoOnly || canSave(draft)}
          saving={saving}
          savedId={savedId}
          error={saveError}
          saveLabel={
            savePhotoOnly
              ? "Save photo for later"
              : view.kind === "confident"
                ? "Save to collection"
                : "Save with these details"
          }
          labelFirst={view.kind !== "confident"}
          onSave={() => (savePhotoOnly ? onSavePhoto() : onSave(draft))}
          onLabel={view.kind === "confident" ? undefined : onLabel}
          onViewSaved={onViewSaved}
          visit={visit}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 16,
    gap: Spacing.two,
  },
  identity: { gap: 2 },
  workTitle: { fontSize: 20, lineHeight: 24, fontWeight: "600" },
  museum: { flexDirection: "row", alignItems: "flex-start", gap: 4 },
  // Centers the icon on the first text line so it stays put when a long name wraps.
  museumIcon: { width: 12, height: 12, marginTop: 3 },
  section: { gap: 4 },
  save: {
    paddingHorizontal: 20,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Gallery.separator,
    backgroundColor: Gallery.paper,
  },
});
