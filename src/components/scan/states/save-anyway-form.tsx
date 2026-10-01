import { Host } from "@expo/ui";
import { Button, Menu } from "@expo/ui/swift-ui";
import { accessibilityLabel, buttonStyle, disabled } from "@expo/ui/swift-ui/modifiers";
import { useState } from "react";

import { ActionStack } from "@/components/action-stack";
import { GalleryButton } from "@/components/collection/gallery-button";
import { CapturePhotosButton } from "@/components/scan/capture-photos-button";
import { FieldsForm } from "@/components/scan/result/fields-form";
import { SaveBar } from "@/components/scan/result/save-bar";
import type { SaveResultInput } from "@/lib/result/save";
import { canSave, draftFromCandidate, type SnapshotDraft } from "@/lib/result/snapshot";

export type SaveAnywayFormProps = {
  compact?: boolean;
  /** Opens the detail fields at once, for a card the person reached by asking to enter details. */
  initiallyEditing?: boolean;
  captureInput?: Omit<SaveResultInput, "draft">;
  saving: boolean;
  savedId?: string;
  saveError?: string;
  onSave: (draft: SnapshotDraft) => void;
  onViewSaved: () => void;
  onDraftChange?: (hasDraft: boolean) => void;
};

/** Blank fields for a card that names no work yet; the title the user types is what gets saved. */
export function SaveAnywayForm({
  compact = false,
  initiallyEditing = false,
  captureInput,
  saving,
  savedId,
  saveError,
  onSave,
  onViewSaved,
  onDraftChange,
}: SaveAnywayFormProps) {
  const [draft, setDraft] = useState(() => draftFromCandidate());
  const [editing, setEditing] = useState(initiallyEditing);
  const editable = !saving && !savedId;
  const saveBar = (
    <SaveBar
      saveLabel={Object.values(draft).some((value) => value.trim()) ? "Save to collection" : "Save photo for later"}
      canSave={canSave(draft)}
      saving={saving}
      savedId={savedId}
      error={saveError}
      onSave={() => onSave(draft)}
      onViewSaved={onViewSaved}
    />
  );
  const detailsButton = editable && !compact && (
    <GalleryButton
      label={editing ? "Hide details" : "Add details (optional)"}
      onPress={() => setEditing((value) => !value)}
    />
  );
  const photosButton = captureInput && editable && !compact && (
    <CapturePhotosButton input={{ ...captureInput, draft }} disabled={saving} />
  );
  return (
    <>
      {!editing && (
        <ActionStack
          textActions={
            <>
              {detailsButton}
              {photosButton}
            </>
          }
        >
          {saveBar}
        </ActionStack>
      )}
      {editable && compact && (
        <Host matchContents colorScheme="light">
          <Menu label="More options" modifiers={[accessibilityLabel("More scan options"), buttonStyle("plain")]}>
            <Button
              label={editing ? "Hide details" : "Add details (optional)"}
              modifiers={[disabled(!editable)]}
              onPress={() => setEditing((value) => !value)}
            />
          </Menu>
        </Host>
      )}
      {editing && detailsButton}
      {editing && (
        <FieldsForm
          draft={draft}
          editable={editable}
          onChange={(field, value) => {
            const next = { ...draft, [field]: value };
            setDraft(next);
            onDraftChange?.(Object.values(next).some((text) => text.trim().length > 0));
          }}
        />
      )}
      {editing && photosButton}
      {editing && saveBar}
    </>
  );
}
