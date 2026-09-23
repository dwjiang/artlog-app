import { LoadingRing } from "@/components/loading-ring";
import { FormSkeleton } from "@/components/loading-skeleton";
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import type { Id } from "../../../../convex/_generated/dataModel";
import type { LabelFlowDisplay } from "../../../../convex/lib/validators";
import { CapturePhotosButton } from "../capture-photos-button";
import { LabelActions } from "../label/label-actions";
import { VerifiedFieldsForm } from "../label/verified-fields-form";
import { SourceChip } from "./source-chip";
import { GalleryButton } from "@/components/collection/gallery-button";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import type { PendingScan } from "@/db/schema";
import { canSaveLabel, canShareLabel, setFieldValue } from "@/lib/label/fields";
import { useLabelForm } from "@/lib/label/use-label-form";
import type { MuseumSearchStage } from "@/lib/museum-search/flow";
import type { MuseumSearchController } from "@/lib/museum-search/use-museum-search";
import { useSaveResult } from "@/lib/result/use-save-result";

const STAGE_TEXT: Record<MuseumSearchStage, string> = {
  exhibitions: "Looking up current exhibitions",
  check: "Comparing the museum’s images on your phone",
  done: "Image confirmed",
  none: "Search finished",
};

type Props = { search: MuseumSearchController; scanId: Id<"scans">; capture?: PendingScan };

export function MuseumSearchSection({ search, scanId, capture }: Props) {
  if (!search.visible) return null;
  if (search.restoring || search.restoreError)
    return (
      <View style={styles.section}>
        {search.restoreError ? (
          <ThemedText>Couldn’t load your museum result. Try again.</ThemedText>
        ) : (
          <FormSkeleton label="Loading museum result…" />
        )}
        {search.restoreError && (
          <GalleryButton label="Try again" variant="outlined" onPress={search.retryRestore} />
        )}
      </View>
    );
  if (!search.flow && !search.running && !search.message) return null;
  return (
    <View style={styles.section}>
      {search.flow && search.confirmedAt !== undefined ? (
        <MuseumSearchResult
          key={`${scanId}:${search.confirmedAt}`}
          flow={search.flow}
          confirmedAt={search.confirmedAt}
          scanId={scanId}
          capture={capture}
        />
      ) : search.running ? (
        <View
          accessibilityLiveRegion="polite"
          accessibilityState={{ busy: true }}
          style={styles.progress}
        >
          <LoadingRing accessibilityLabel="Searching the museum’s collection…" />
          {search.progress && (
            <ThemedText type="small" themeColor="textSecondary">
              {STAGE_TEXT[search.progress]}
            </ThemedText>
          )}
        </View>
      ) : (
        search.message && <ThemedText themeColor="textSecondary">{search.message}</ThemedText>
      )}
    </View>
  );
}

function MuseumSearchResult({
  flow,
  confirmedAt,
  scanId,
  capture,
}: {
  flow: LabelFlowDisplay;
  confirmedAt: number;
  scanId: Id<"scans">;
  capture?: PendingScan;
}) {
  const router = useRouter();
  const {
    form,
    setForm,
    error: formError,
    retry: retryForm,
  } = useLabelForm(scanId, flow, confirmedAt);
  const {
    saving,
    savedId,
    completion,
    error: saveError,
    save,
    sharing,
    shared,
    shareError,
    retrySharing,
  } = useSaveResult();

  if (!form)
    return (
      <View style={styles.section}>
        {formError ? (
          <ThemedText>{formError.message}</ThemedText>
        ) : (
          <FormSkeleton label="Loading your edits…" />
        )}
        {formError && <GalleryButton label="Try again" variant="outlined" onPress={retryForm} />}
      </View>
    );

  const contribution =
    capture && capture.venueId && canShareLabel(form)
      ? { scanId, capture, state: form, museumSearchUpdatedAt: confirmedAt }
      : undefined;
  const input = {
    scanId,
    capture,
    contribution,
    draft: {
      title: form.title.value,
      artist: form.artist.value,
      date: form.date.value,
      medium: form.medium.value,
      institution: "",
    },
  };

  return (
    <>
      <ThemedText type="subtitle">{"Found on the museum's site"}</ThemedText>
      {flow.sourceUrl && <SourceChip label="Museum page" url={flow.sourceUrl} />}
      <VerifiedFieldsForm
        state={form}
        warnings={flow.warnings}
        editable={!saving && !sharing && !shared && !savedId}
        onChange={(name, value) =>
          setForm((current) => current && setFieldValue(current, name, value))
        }
      />
      {capture && !savedId && (
        <CapturePhotosButton disabled={saving} input={{ ...input, capture }} />
      )}
      <LabelActions
        canSave={canSaveLabel(form)}
        allowContribution={!!contribution}
        saving={saving}
        sharing={sharing}
        savedId={savedId}
        completion={completion}
        shared={shared}
        saveError={saveError}
        shareError={shareError}
        onSave={() => {
          void save(input);
        }}
        onShare={() => {
          void retrySharing();
        }}
        onViewSaved={() =>
          router.push({ pathname: "/saved/[savedId]", params: { savedId: savedId ?? "" } })
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.three },
  progress: { gap: Spacing.one },
});
