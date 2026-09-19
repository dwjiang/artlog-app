import { useState } from 'react';

import { CapturePhotosButton } from '../capture-photos-button';
import type { SaveResultInput } from '@/lib/result/save';
import { FieldsForm } from '../result/fields-form';
import { SaveBar } from '../result/save-bar';
import { canSave, draftFromCandidate, type SnapshotDraft } from '@/lib/result/snapshot';
import { GalleryButton } from '@/components/collection/gallery-button';

export type SaveAnywayFormProps = {
  captureInput?: Omit<SaveResultInput, 'draft'>;
  saving: boolean;
  savedId?: string;
  saveError?: string;
  onSave: (draft: SnapshotDraft) => void;
  onViewSaved: () => void;
  onDraftChange?: (hasDraft: boolean) => void;
};

/** Blank fields for a card that names no work yet; the title the user types is what gets saved. */
export function SaveAnywayForm({ captureInput, saving, savedId, saveError, onSave, onViewSaved, onDraftChange }: SaveAnywayFormProps) {
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
      {editable && <GalleryButton label={editing ? 'Hide details' : 'Add details (optional)'} onPress={() => setEditing((value) => !value)} />}
      {editing && <FieldsForm draft={draft} editable={editable} onChange={(field, value) => {
        const next = { ...draft, [field]: value };
        setDraft(next);
        onDraftChange?.(Object.values(next).some((text) => text.trim().length > 0));
      }} />}
      {captureInput && editable && <CapturePhotosButton input={{ ...captureInput, draft }} disabled={saving} />}
      {editing && saveBar}
    </>
  );
}
