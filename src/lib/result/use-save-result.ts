import * as Haptics from 'expo-haptics';
import type { CaptureCompletion } from '../capture/completion';
import { useRef, useState } from 'react';

import { saveErrorMessage, saveResult, type SaveResultInput } from './save';

export type SaveInput = Omit<SaveResultInput, 'capture'> & { capture?: SaveResultInput['capture'] };

/** A card's save state; a capture missing from this phone or a failed write leaves the draft editable with a message. */
export function useSaveResult() {
  const inFlight = useRef(false);
  const [completion, setCompletion] = useState<CaptureCompletion>();
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string>();
  const [error, setError] = useState<string>();

  async function save({ capture, ...input }: SaveInput): Promise<void> {
    if (inFlight.current) return;
    if (!capture) {
      setError('Your photo of this scan isn’t on this phone, so it can’t be saved.');
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setError(undefined);
    try {
      const { localId, completion } = await saveResult({ ...input, capture });
      setSavedId(localId);
      setCompletion(completion);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (cause) {
      console.warn('Could not save the work', cause);
      setError(saveErrorMessage(cause));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return { saving, savedId, completion, error, save };
}
