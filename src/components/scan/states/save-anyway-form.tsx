import { Host } from '@expo/ui';
import { Button, Menu } from '@expo/ui/swift-ui';
import { accessibilityLabel, buttonStyle, disabled } from '@expo/ui/swift-ui/modifiers';
import { useState } from 'react';

import { CapturePhotosButton } from '../capture-photos-button';
import type { SaveResultInput } from '@/lib/result/save';
import { FieldsForm } from '../result/fields-form';
import { SaveBar } from '../result/save-bar';
import { canSave, draftFromCandidate, type SnapshotDraft } from '@/lib/result/snapshot';
import { GalleryButton } from '@/components/collection/gallery-button';

export type SaveAnywayFormProps = {
  compact?: boolean;
  captureInput?: Omit<SaveResultInput, 'draft'>;
  saving: boolean;
  savedId?: string;
  saveError?: string;
  onSave: (draft: SnapshotDraft) => void;
  onViewSaved: () => void;
  onDraftChange?: (hasDraft: boolean) => void;
};

/** Blank fields for a card that names no work yet; the title the user types is what gets saved. */
export function SaveAnywayForm({ compact = false, captureInput, saving, savedId, saveError, onSave, onViewSaved, onDraftChange }: SaveAnywayFormProps) {
  const [draft, setDraft] = useState(() => draftFromCandidate());
  const [editing, setEditing] = useState(false);
  const editable = !saving && !savedId;
  const saveBar = <SaveBar
    saveLabel={Object.values(draft).some((value) => value.trim()) ? 'Save to collection' : 'Save photo for later'}
    canSave={canSave(draft)} saving={saving} savedId={savedId} error={saveError}
    onSave={() => onSave(draft)} onViewSaved={onViewSaved} />;
  return (
    <>
      {!editing && saveBar}
      {editable && compact && <Host matchContents colorScheme="light"><Menu label="More options" modifiers={[accessibilityLabel('More scan options'), buttonStyle('plain')]}><Button label={editing ? 'Hide details' : 'Add details (optional)'} modifiers={[disabled(!editable)]} onPress={() => setEditing((value) => !value)} /></Menu></Host>}
      {editable && !compact && <GalleryButton label={editing ? 'Hide details' : 'Add details (optional)'} onPress={() => setEditing((value) => !value)} />}
      {editing && <FieldsForm draft={draft} editable={editable} onChange={(field, value) => {
        const next = { ...draft, [field]: value };
        setDraft(next);
        onDraftChange?.(Object.values(next).some((text) => text.trim().length > 0));
      }} />}
      {captureInput && editable && !compact && <CapturePhotosButton input={{ ...captureInput, draft }} disabled={saving} />}
      {editing && saveBar}
    </>
  );
}
