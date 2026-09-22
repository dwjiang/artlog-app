import { reportError, addBreadcrumb } from '@/lib/observability';
import * as Haptics from 'expo-haptics';
import type { CaptureCompletion } from '../capture/completion';
import { useRef, useState } from 'react';

import { saveErrorMessage, saveResult, type SaveResultInput } from './save';
import { contributionErrorMessage, type ContributionOutcome, type ContributeInput } from '../label/contribute';
import { shareSavedLabel, type ContributionAttempt } from '../label/share-saved-label';

export type SaveInput = Omit<SaveResultInput, 'capture'> & { capture?: SaveResultInput['capture'] };

/** A card's save state; a capture missing from this phone or a failed write leaves the draft editable with a message. */
export function useSaveResult() {
  const inFlight = useRef(false);
  const [completion, setCompletion] = useState<CaptureCompletion>();
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string>();
  const [error, setError] = useState<string>();
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState<ContributionOutcome>();
  const [shareError, setShareError] = useState<string>();
  const retry = useRef<{ input: ContributeInput; savedLocalId: string } | undefined>(undefined);
  const sharingNow = useRef(false);

  async function trackContribution(attempt: Promise<ContributionAttempt>) {
    sharingNow.current = true;
    setSharing(true); setShareError(undefined);
    try {
      const outcome = await attempt;
      setShared(outcome.result); setShareError(outcome.error);
    } catch (cause) {
      reportError(cause, 'result.share');
      console.warn('Could not save the work to the shared index', cause);
      setShareError(contributionErrorMessage(cause));
    } finally {
      sharingNow.current = false;
      setSharing(false);
    }
  }

  async function retrySharing() {
    if (!retry.current || sharingNow.current) return;
    await trackContribution(shareSavedLabel(retry.current.input, retry.current.savedLocalId));
  }

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
      const { localId, completion, contribution } = await saveResult({ ...input, capture });
      addBreadcrumb('result.saved', { hasContribution: !!contribution });
      setSavedId(localId);
      setCompletion(completion);
      if (contribution && input.contribution) {
        retry.current = { input: input.contribution, savedLocalId: localId };
        void trackContribution(contribution);
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (cause) {
      reportError(cause, 'result.save');
      console.warn('Could not save the work', cause);
      setError(saveErrorMessage(cause));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return { saving, savedId, completion, error, save, sharing, shared, shareError, retrySharing };
}
