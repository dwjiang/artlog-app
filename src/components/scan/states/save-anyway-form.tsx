import { useState } from 'react';

import { FieldsForm } from '../result/fields-form';
import { SaveBar } from '../result/save-bar';
import { canSave, draftFromCandidate, type SnapshotDraft } from '@/lib/result/snapshot';

export type SaveAnywayFormProps = {
  saving: boolean;
  savedId?: string;
  saveError?: string;
  onSave: (draft: SnapshotDraft) => void;
  onViewSaved: () => void;
  onDraftChange?: (hasDraft: boolean) => void;
};

/** Blank fields for a card that names no work yet; the title the user types is what gets saved. */
export function SaveAnywayForm({ saving, savedId, saveError, onSave, onViewSaved, onDraftChange }: SaveAnywayFormProps) {
  const [draft, setDraft] = useState(() => draftFromCandidate());
  const editable = !saving && !savedId;
  return (
    <>
      <FieldsForm draft={draft} editable={editable} onChange={(field, value) => {
        const next = { ...draft, [field]: value };
        setDraft(next);
        onDraftChange?.(Object.values(next).some((text) => text.trim().length > 0));
      }} />
      <SaveBar
        saveLabel="Save anyway"
        canSave={canSave(draft)}
        saving={saving}
        savedId={savedId}
        error={saveError}
        onSave={() => onSave(draft)}
        onViewSaved={onViewSaved}
      />
    </>
  );
}
