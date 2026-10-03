import { GalleryButton } from "@/components/collection/gallery-button";
import { LoadingRing } from "@/components/loading-ring";
import { ThemedText } from "@/components/themed-text";
import type { ContributionOutcome } from "@/lib/label/contribute";

import { ContributeResult } from "./contribute-result";

export const SHARE_BUTTON = "Retry saving to the shared index";
// The notice above a save that also shares: wording changes need the operator's review.
export const SHARING_NOTICE =
  "Also saves the confirmed label, a numeric fingerprint of your photo and a small artwork crop to the shared index for other visitors. Your full photos stay private.";

export type ContributionStatusProps = {
  sharing: boolean;
  shared?: ContributionOutcome;
  shareError?: string;
  onShare: () => void;
};

export function ContributionStatus({ sharing, shared, shareError, onShare }: ContributionStatusProps) {
  return (
    <>
      {shared && <ContributeResult result={shared} />}
      {sharing && !shareError && <LoadingRing accessibilityLabel="Saving to the shared index…" />}
      {shareError && (
        <>
          <ThemedText type="small" themeColor="error" accessibilityRole="alert">
            {shareError}. Your artwork is saved to your collection.
          </ThemedText>
          <GalleryButton
            label={SHARE_BUTTON}
            variant="outlined"
            fullWidth
            busy={sharing}
            busyLabel="Saving to the shared index…"
            onPress={onShare}
          />
        </>
      )}
    </>
  );
}
