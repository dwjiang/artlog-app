import * as Haptics from 'expo-haptics';
import { useState } from 'react';

import { saveResult, type SaveResultInput } from './save';

export type SaveInput = Omit<SaveResultInput, 'capture'> & { capture?: SaveResultInput['capture'] };

/** A card's save state; a capture missing from this phone or a failed write leaves the draft editable with a message. */
export function useSaveResult() {
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string>();
  const [error, setError] = useState<string>();

  async function save({ capture, ...input }: SaveInput): Promise<void> {
    if (!capture) {
      setError('Your photo of this scan isn’t on this phone, so it can’t be saved.');
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const { localId } = await saveResult({ ...input, capture });
      setSavedId(localId);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (cause) {
      console.warn('Could not save the work', cause);
      setError('Couldn’t save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return { saving, savedId, error, save };
}
