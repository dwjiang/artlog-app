import { Stack } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ArtworkIdentity } from "@/components/artwork/artwork-identity";
import { ArtworkStory } from "@/components/artwork/artwork-story";
import { GalleryButton } from "@/components/collection/gallery-button";
import { HighlightHeading } from "@/components/highlight-heading";
import { useCapturePhotos } from "@/components/scan/capture-photos-button";
import { ThemedText } from "@/components/themed-text";
import { Gallery, PinnedFooterBorder, Radius, Spacing } from "@/constants/theme";
import { captureFileUri, scanDisplayPath } from "@/lib/files/photos";
import type { SaveResultInput } from "@/lib/result/save";
import { canSave, draftFromCandidate, draftFromConfirmed, type SnapshotDraft } from "@/lib/result/snapshot";
import type { ResultCandidate, ResultViewState } from "@/lib/result/state";
import { useLiftToasts } from "@/lib/ui/toast";

import type { Id } from "../../../../convex/_generated/dataModel";
import { FieldsForm } from "./fields-form";
import { RunnerUps } from "./runner-ups";
import { LABEL_BUTTON, SaveBar } from "./save-bar";
import { TentativeOriginNotice } from "./tentative-origin-notice";

type ResultCardProps = {
  manual?: boolean;
  scanId?: Id<"scans">;
  captureInput?: Omit<SaveResultInput, "draft">;
  view: ResultViewState;
  saving: boolean;
  savedId?: string;
  saveError?: string;
  header: ReactNode;
  context?: ReactNode;
  visit?: ReactNode;
  onLabel: () => void;
  /** Opens the details screen for an unidentified, confirmed or linked card; without it, details are edited in place. */
  onEnterDetails?: () => void;
  onRetryDocent?: () => Promise<unknown>;
  onPick: (candidate: ResultCandidate) => void;
  onEdit: () => void;
  onSave: (draft: SnapshotDraft) => void;
  onSavePhoto: () => void;
  savePhotoOnly: boolean;
  saveNotice?: string;
  onViewSaved: () => void;
};

/** Keyed by the named work, so a new primary resets the draft while streamed prose leaves edits alone. */
export function ResultCard({
  manual = false,
  scanId,
  captureInput,
  view,
  saving,
  savedId,
  saveError,
  header,
  context,
  visit,
  onLabel,
  onEnterDetails,
  onRetryDocent,
  onPick,
  onEdit,
  onSave,
  onSavePhoto,
  savePhotoOnly,
  saveNotice,
  onViewSaved,
}: ResultCardProps) {
  const [draft, setDraft] = useState(() =>
    view.confirmed ? draftFromConfirmed(view.confirmed.fields) : draftFromCandidate(view.primary),
  );
  const [editingDetails, setEditingDetails] = useState(manual);
  const { bottom } = useSafeAreaInsets();
  const [saveBarHeight, setSaveBarHeight] = useState<number>();
  useLiftToasts(saveBarHeight, useIsFocused());
  const editable = !saving && !savedId;
  const named = view.kind === "confident" || view.kind === "confirmed";
  const attributed = !editingDetails && view.kind !== "soft";
  const suggestions = editable && view.kind !== "confident" ? view.runnerUps : [];
  // A suggested work keeps its catalogue link while its details are corrected in place; a work the owner named
  // from a label or their details goes back to where they named it.
  const enterDetails =
    view.kind === "unidentified" || view.kind === "confirmed" || view.linked ? onEnterDetails : undefined;
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
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="Scan options" tintColor={Gallery.ink}>
          {!editingDetails && (
            <Stack.Toolbar.MenuAction
              icon="pencil"
              disabled={!editable}
              onPress={enterDetails ?? (() => setEditingDetails(true))}
            >
              Edit Details
            </Stack.Toolbar.MenuAction>
          )}
          {view.kind === "confident" && (
            <Stack.Toolbar.MenuAction icon="text.viewfinder" disabled={!editable} onPress={onLabel}>
              Scan the Label
            </Stack.Toolbar.MenuAction>
          )}
          <Stack.Toolbar.MenuAction
            icon="photo.badge.plus"
            subtitle={photos.photoCount > 1 ? `${photos.photoCount} photos` : undefined}
            disabled={photos.unavailable}
            onPress={photos.open}
          >
            Add Photos
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
        {editingDetails && (
          <Stack.Toolbar.Button
            variant="done"
            tintColor={Gallery.accent}
            disabled={!editable}
            onPress={() => setEditingDetails(false)}
          >
            Done
          </Stack.Toolbar.Button>
        )}
      </Stack.Toolbar>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        contentContainerStyle={styles.content}
      >
        {header}
        <ArtworkIdentity
          title={view.kind === "soft" ? `Could this be ${draft.title}?` : draft.title || "Unidentified artwork"}
          artist={attributed ? draft.artist : undefined}
          date={attributed ? draft.date : undefined}
          medium={!editingDetails && named ? draft.medium : undefined}
          institution={!editingDetails && named ? draft.institution : undefined}
        />
        {!named && !manual && (
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
        {named && (
          <ArtworkStory
            artworkId={view.primary?.artworkId}
            title={draft.title}
            artist={draft.artist}
            date={draft.date}
            scanId={captureInput?.scanId}
            savedId={savedId}
            imageUri={
              captureInput?.capture ? captureFileUri(scanDisplayPath(captureInput.capture.cropPath)) : undefined
            }
            docent={view.docent}
            factSheet={view.factSheet}
            status={view.docentStatus}
            onRetry={onRetryDocent}
            report={
              view.primary
                ? { kind: "docent", artworkId: view.primary.artworkId }
                : scanId && { kind: "scanDocent", scanId }
            }
          />
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
          saveLabel={savePhotoOnly ? "Save photo for later" : named ? "Save to collection" : "Save with these details"}
          onSave={() => (savePhotoOnly ? onSavePhoto() : onSave(draft))}
          onViewSaved={onViewSaved}
          visit={visit}
          notice={saveNotice}
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
  section: { gap: Spacing.compact, paddingTop: Spacing.two },
  recovery: { gap: Spacing.two, padding: Spacing.three, borderRadius: Radius.card, backgroundColor: Gallery.fill },
  save: {
    paddingHorizontal: 20,
    ...PinnedFooterBorder,
    backgroundColor: Gallery.paper,
  },
});
