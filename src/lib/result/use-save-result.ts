import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";

import { isArtworkInVisit } from "@/db/repos/artwork-album";
import type { CaptureCompletion } from "@/lib/capture/completion";
import { captureFileUri } from "@/lib/files/photos";
import { useMakeVisit } from "@/lib/journal/visitless-saves";
import { contributionErrorMessage, contributionMessage, type ContributeInput } from "@/lib/label/contribute";
import { shareSavedLabel, type ContributionAttempt } from "@/lib/label/share-saved-label";
import { reportError, addBreadcrumb } from "@/lib/observability";
import { playSuccessHaptic } from "@/lib/ui/haptics";
import { showErrorToast, showToast } from "@/lib/ui/toast";
import { withEndVisitPrompt } from "@/lib/venue/end-visit-prompt";

import { saveErrorMessage, saveResult, type SaveResultInput } from "./save";

export type SaveInput = Omit<SaveResultInput, "capture"> & {
  capture?: SaveResultInput["capture"];
};

/**
 * A card's save state. A completed save returns to the camera, where a toast confirms it: View opens the artwork, or Add
 * to visit files a save that joined no visit. A capture missing from this phone or a failed write leaves the draft
 * editable with a message.
 */
export function useSaveResult() {
  const router = useRouter();
  const { make } = useMakeVisit();
  const inFlight = useRef(false);
  const [completion, setCompletion] = useState<CaptureCompletion>();
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string>();
  const [error, setError] = useState<string>();
  const retry = useRef<{ input: ContributeInput; savedLocalId: string } | undefined>(undefined);
  const sharingNow = useRef(false);

  useEffect(() => {
    if (!completion) return;
    router.dismissAll();
    router.navigate("/(tabs)/(scan)/scan");
  }, [completion, router]);

  function confirmSave({ savedId, capture, visitOutcome, previewPath }: CaptureCompletion) {
    let inVisit = !!visitOutcome;
    try {
      inVisit ||= isArtworkInVisit(savedId);
    } catch (cause) {
      // The save itself succeeded; without the check the toast offers View, which works either way.
      reportError(cause, "result.visit_check");
      inVisit = true;
    }
    showToast(
      visitOutcome === "started" ? "Saved · visit started" : "Saved",
      inVisit
        ? { label: "View", onPress: () => router.navigate({ pathname: "/saved/[savedId]", params: { savedId } }) }
        : { label: "Add to visit", onPress: () => make([savedId], capture.venueId, capture) },
      previewPath ? captureFileUri(previewPath) : undefined,
    );
  }

  // The shared index answers after the save has returned to the camera, so its outcome replaces the save's toast there.
  async function trackContribution(attempt: Promise<ContributionAttempt>) {
    sharingNow.current = true;
    let error: string | undefined;
    try {
      const outcome = await attempt;
      if (outcome.result) showToast(contributionMessage(outcome.result));
      error = outcome.error;
    } catch (cause) {
      reportError(cause, "result.share");
      console.warn("Could not save the work to the shared index", cause);
      error = contributionErrorMessage(cause);
    } finally {
      sharingNow.current = false;
    }
    if (error) {
      showErrorToast(`${error}. Your artwork is saved to your collection.`, () => void retrySharing(), { quiet: true });
    }
  }

  async function retrySharing() {
    if (!retry.current || sharingNow.current) return;
    await trackContribution(shareSavedLabel(retry.current.input, retry.current.savedLocalId));
  }

  async function save({ capture, ...input }: SaveInput): Promise<void> {
    if (inFlight.current) return;
    if (!capture) {
      setError("Your photo of this scan isn’t on this phone, so it can’t be saved.");
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setError(undefined);
    try {
      const saved = await withEndVisitPrompt((withoutVisit) => saveResult({ ...input, capture }, { withoutVisit }));
      if (!saved) return;
      const { localId, completion, contribution } = saved;
      addBreadcrumb("result.saved", { hasContribution: !!contribution });
      setSavedId(localId);
      setCompletion(completion);
      confirmSave(completion);
      if (contribution && input.contribution) {
        retry.current = { input: input.contribution, savedLocalId: localId };
        void trackContribution(contribution);
      }
      playSuccessHaptic();
    } catch (cause) {
      reportError(cause, "result.save");
      console.warn("Could not save the work", cause);
      setError(saveErrorMessage(cause));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return {
    saving,
    savedId,
    completion,
    error,
    save,
  };
}
