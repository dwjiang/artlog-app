import { Image } from "expo-image";
import { Stack } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GuideTranscript } from "@/components/audio/guide-transcript";
import { ListenActions } from "@/components/audio/listen-actions";
import { GalleryButton } from "@/components/collection/gallery-button";
import { HighlightHeading } from "@/components/highlight-heading";
import { useCapturePhotos } from "@/components/scan/capture-photos-button";
import { ThemedText } from "@/components/themed-text";
import { Gallery, Radius, Spacing } from "@/constants/theme";
import { captureFileUri, scanPreviewPath } from "@/lib/files/photos";
import type { SaveResultInput } from "@/lib/result/save";
import { canSave, draftFromCandidate, type SnapshotDraft } from "@/lib/result/snapshot";
import type { ResultCandidate, ResultViewState } from "@/lib/result/state";
import { useLiftToasts } from "@/lib/ui/toast";

import { DocentSection } from "./docent-section";
import { FieldsForm } from "./fields-form";
import { RightNowSection } from "./right-now-section";
import { RunnerUps } from "./runner-ups";
import { LABEL_BUTTON, SaveBar } from "./save-bar";
import { TentativeOriginNotice } from "./tentative-origin-notice";

type ResultCardProps = {
  manual?: boolean;
  captureInput?: Omit<SaveResultInput, "draft">;
  view: ResultViewState;
  saving: boolean;
  savedId?: string;
  saveError?: string;
  header: ReactNode;
  context?: ReactNode;
  visit?: ReactNode;
  onLabel: () => void;
  onRetryDocent?: () => Promise<unknown>;
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
  captureInput,
  view,
  saving,
  savedId,
  saveError,
  header,
  context,
  visit,
  onLabel,
  onRetryDocent,
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
  const [saveBarHeight, setSaveBarHeight] = useState<number>();
  useLiftToasts(saveBarHeight, useIsFocused());
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
          <Stack.Toolbar.MenuAction
            icon={editingDetails ? "checkmark" : "pencil"}
            disabled={!editable}
            onPress={() => setEditingDetails((value) => !value)}
          >
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
          <ThemedText type="title">
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
                <View style={styles.metadata}>
                  <Image
                    source="sf:paintbrush.pointed"
                    tintColor={Gallery.muted}
                    style={styles.metadataIcon}
                    accessible={false}
                  />
                  <ThemedText variant="metadata" themeColor="textSecondary" style={{ flexShrink: 1 }}>
                    {draft.medium}
                  </ThemedText>
                </View>
              )}
              {view.kind === "confident" && !!draft.institution && (
                <View style={styles.metadata}>
                  <Image
                    source="sf:building.columns"
                    tintColor={Gallery.muted}
                    style={styles.metadataIcon}
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
        {view.kind !== "confident" && !manual && (
          <View style={styles.recovery}>
            <ThemedText themeColor="textSecondary">
              {view.primary
                ? "This match needs a closer look. Scan the museum label to check the details, or keep your photo for later."
                : "No match yet. Scan the museum label, or save the photo and add details later."}
            </ThemedText>
            {view.kind === "soft" && (
              <ThemedText variant="secondary" themeColor="textSecondary">
                Possible artist · {draft.artist || "Unknown"}
              </ThemedText>
            )}
            <GalleryButton
              label={LABEL_BUTTON}
              icon="text.viewfinder"
              fullWidth
              variant="outlined"
              disabled={!editable}
              onPress={onLabel}
            />
          </View>
        )}
        {view.primary?.identityStatus === "tentative" && <TentativeOriginNotice />}
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
        {view.kind === "confident" && (
          <View style={styles.about}>
            <DocentSection
              title="About this work"
              docent={view.docent}
              factSheet={view.factSheet}
              status={view.docentStatus}
              onRetry={onRetryDocent}
            />
            {view.primary && (
              <>
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
                <GuideTranscript artworkId={view.primary.artworkId} />
              </>
            )}
            <RightNowSection rightNow={view.rightNow} />
          </View>
        )}
        {suggestions.length > 0 && (
          <View style={styles.section}>
            <HighlightHeading>Other possibilities</HighlightHeading>
            <RunnerUps candidates={suggestions} onPick={onPick} />
          </View>
        )}
        {context}
      </ScrollView>
      <View
        onLayout={(event) => setSaveBarHeight(event.nativeEvent.layout.height)}
        style={[styles.save, { paddingTop: visit && !savedId ? 0 : Spacing.two, paddingBottom: Math.max(12, bottom) }]}
      >
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
          onSave={() => (savePhotoOnly ? onSavePhoto() : onSave(draft))}
          onViewSaved={onViewSaved}
          visit={visit}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.content,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
    gap: Spacing.three,
  },
  identity: { gap: Spacing.two },
  workTitle: { fontSize: 18, lineHeight: 26 },
  metadata: { flexDirection: "row", alignItems: "flex-start", gap: 4 },
  // Centers the icon on the first text line so it stays put when a long name wraps.
  metadataIcon: { width: 12, height: 12, marginTop: 3 },
  section: { gap: Spacing.compact, paddingTop: Spacing.two },
  recovery: { gap: Spacing.two, padding: Spacing.three, borderRadius: Radius.card, backgroundColor: Gallery.fill },
  about: { gap: Spacing.three },
  save: {
    paddingHorizontal: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Gallery.separator,
    backgroundColor: Gallery.paper,
  },
});
