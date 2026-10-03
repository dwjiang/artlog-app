import { useRouter } from "expo-router";

import { GalleryButton } from "@/components/collection/gallery-button";
import { CaptureCompletion } from "@/components/scan/capture-completion";
import { ThemedText } from "@/components/themed-text";
import type { PendingScan } from "@/db/schema";
import { toConfirmedFields } from "@/lib/label/fields";
import { canSave, draftFromConfirmed } from "@/lib/result/snapshot";
import { useConfirmDetails } from "@/lib/result/use-confirm-details";
import { useSaveResult } from "@/lib/result/use-save-result";

import type { Id } from "../../../../convex/_generated/dataModel";
import type { ConfirmedSource } from "../../../../convex/lib/validators";
import { ConfirmDetailsForm, type ConfirmDetailsFormProps } from "./confirm-details-form";

type Props = Omit<
  ConfirmDetailsFormProps,
  "confirming" | "error" | "onConfirm" | "disabled" | "confirmDisabled" | "children"
> & {
  scanId: Id<"scans"> | undefined;
  sourceKind: ConfirmedSource;
  capture?: PendingScan;
};

export function ConfirmDetailsReview({ scanId, sourceKind, capture, ...formProps }: Props) {
  const router = useRouter();
  const confirmation = useConfirmDetails(scanId, sourceKind);
  const local = useSaveResult();
  const fields = toConfirmedFields(formProps.form);
  const draft = fields && draftFromConfirmed(fields);
  const fallback = confirmation.offline || confirmation.unavailable;

  return (
    <CaptureCompletion completion={local.completion}>
      <ConfirmDetailsForm
        {...formProps}
        confirming={confirmation.confirming}
        disabled={local.saving || !!local.savedId}
        confirmDisabled={confirmation.offline}
        error={local.error ?? confirmation.error}
        onConfirm={() => void confirmation.confirm(formProps.form)}
      >
        {local.savedId ? (
          <GalleryButton
            label="View artwork"
            fullWidth
            onPress={() => router.push({ pathname: "/saved/[savedId]", params: { savedId: local.savedId! } })}
          />
        ) : fallback && capture ? (
          <>
            <ThemedText themeColor="textSecondary">
              You can save your photo and details privately without background information.
            </ThemedText>
            <GalleryButton
              label="Save to collection"
              variant="filled"
              fullWidth
              busy={local.saving}
              busyLabel="Saving…"
              disabled={!draft || !canSave(draft) || local.saving || confirmation.confirming}
              onPress={() => {
                if (draft) void local.save({ scanId, capture, draft });
              }}
            />
          </>
        ) : null}
      </ConfirmDetailsForm>
    </CaptureCompletion>
  );
}
