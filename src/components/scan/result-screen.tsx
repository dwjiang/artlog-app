import { useConvex } from "convex/react";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { LoadingRing } from "@/components/loading-ring";
import { SafeAreaScrollView } from "@/components/safe-area-scroll";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Colors, Spacing } from "@/constants/theme";
import { markFailed, selectCaptureForScan } from "@/db/repos/pending-scans";
import { useScreenActive } from "@/hooks/use-screen-active";
import { useLocalOwner } from "@/lib/account/owner-store";
import { isLabelCapture } from "@/lib/capture/photo-draft";
import { captureFileUri, scanDisplayPath } from "@/lib/files/photos";
import { SHARING_NOTICE } from "@/lib/label/contribute";
import { canShareLabel, confirmedLabelForm } from "@/lib/label/fields";
import { reportError } from "@/lib/observability";
import { retryPendingScan } from "@/lib/queue/queue";
import {
  consumeRejection,
  handOffLabelRejection,
  rejectMatch,
  resolveWithRunnerUp,
  type Rejection,
} from "@/lib/result/feedback";
import { useSheetMatchPreview } from "@/lib/result/match-preview";
import { draftFromCandidate, type SnapshotDraft } from "@/lib/result/snapshot";
import {
  toResultViewState,
  type ResultCandidate,
  type ResultSelection,
  type ResultViewState,
} from "@/lib/result/state";
import { useSaveResult } from "@/lib/result/use-save-result";
import { useScan } from "@/lib/result/use-scan";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { CaptureContextButton } from "./capture-context-button";
import { LocalScanScreen } from "./local-scan-screen";
import { CardHeader } from "./result/card-header";
import { NotRightSheet } from "./result/not-right-sheet";
import { ResultCard } from "./result/result-card";
import { ScanCropEditor } from "./scan-crop-editor";
import { FailedCard } from "./states/failed-card";
import { SaveAnywayForm } from "./states/save-anyway-form";
import { UnsupportedCard } from "./states/unsupported-card";

export type ResultScreenProps = {
  scanId: string;
  manual?: boolean;
};

const LOCAL_PREFIX = "local-";

export function ResultScreen({ scanId, manual = false }: ResultScreenProps) {
  const owner = useLocalOwner();
  // The router reuses this screen for a new scan id; the key drops the previous card's draft, save and feedback state.
  if (scanId.startsWith(LOCAL_PREFIX)) {
    return (
      <LocalScanScreen
        key={`${owner}:${scanId}:${manual}`}
        localId={scanId.slice(LOCAL_PREFIX.length)}
        manual={manual}
      />
    );
  }
  return <ScanResultScreen key={`${owner}:${scanId}`} scanId={scanId as Id<"scans">} />;
}

type Sheet = { open: boolean; notice?: string };

function ScanResultScreen({ scanId }: { scanId: Id<"scans"> }) {
  const owner = useLocalOwner();
  const router = useRouter();
  const isActive = useScreenActive();
  const client = useConvex();
  const scan = useScan(scanId);
  const {
    data: captures,
    updatedAt: captureUpdatedAt,
    error: captureError,
  } = useLiveQuery(selectCaptureForScan(scanId, owner), [scanId, owner]);
  useEffect(() => {
    if (captureError) reportError(captureError, "result.load_capture");
  }, [captureError]);
  const capture = captures.find((row) => row.owner === owner);
  const loaded = scan && !(scan instanceof Error) ? scan : undefined;
  // A label-only capture opens on its label until the owner confirms the details it read or links their work.
  const labelOnly = !!capture && isLabelCapture(capture);
  const labelCapture = labelOnly && !loaded?.confirmed && !loaded?.linked;
  const [selection, setSelection] = useState<ResultSelection>({});
  const [retryError, setRetryError] = useState<string>();
  const [retrying, setRetrying] = useState(false);
  const [editingCrop, setEditingCrop] = useState(false);
  const [hasEdits, setHasEdits] = useState(false);
  const [sheet, setSheet] = useState<Sheet>({ open: false });
  const { saving, savedId, error: saveError, save } = useSaveResult();
  // Consume feedback before awaiting the network so revisiting a match cannot submit another resolution.
  const rejections = useRef(new Map<Id<"objects">, Rejection>());
  const rejection = useRef<Rejection>(undefined);
  const view: ResultViewState = toResultViewState(scan, selection);
  const { confirmed } = view;
  const namedBy = confirmed?.source ?? view.linked;
  const labelFlow = loaded?.labelFlow;
  // Details confirmed from a verified label are shared with the save, as the label screen promised.
  const labelForm =
    confirmed?.source === "label" && labelFlow?.stage === "verified"
      ? confirmedLabelForm(labelFlow, confirmed.fields)
      : undefined;
  const contribution =
    labelForm && capture?.venueId && !labelOnly && canShareLabel(labelForm)
      ? { scanId, capture, state: labelForm }
      : undefined;

  useEffect(() => {
    if (isActive && labelCapture && scan !== undefined) {
      router.replace({ pathname: "/label/[scanId]", params: { scanId } });
    }
  }, [isActive, labelCapture, router, scan, scanId]);

  function enterDetails() {
    router.push({ pathname: "/enter-details/[scanId]", params: { scanId } });
  }

  function editConfirmed() {
    if (namedBy === "label") router.push({ pathname: "/label/[scanId]", params: { scanId } });
    else enterDetails();
  }

  function adjustCrop() {
    if (hasEdits) {
      Alert.alert("Adjust this crop?", "Recognition will run again. Unsaved artwork details will be discarded.", [
        { text: "Keep editing", style: "cancel" },
        {
          text: "Adjust crop",
          onPress: () => {
            setHasEdits(false);
            setEditingCrop(true);
          },
        },
      ]);
    } else {
      setEditingCrop(true);
    }
  }

  function openLabel() {
    setSheet({ open: false });
    if (rejection.current) handOffLabelRejection(scanId, rejection.current);
    router.push({ pathname: "/label/[scanId]", params: { scanId } });
  }

  function notRight() {
    const { primary } = view;
    if (!primary) return;
    setSheet({ open: true });
    const existing = rejections.current.get(primary.objectId);
    if (existing) {
      rejection.current = existing;
      return;
    }
    const pending = rejectMatch(client, scanId, primary.objectId).then(
      (feedback) => {
        if (!feedback) {
          rejections.current.delete(primary.objectId);
          setSheet((current) =>
            current.open ? { ...current, notice: "This device can’t send feedback yet." } : current,
          );
          return null;
        }
        if (!feedback.canResolve) {
          entry.consumed = true;
          return null;
        }
        return feedback.feedbackId;
      },
      (error: unknown) => {
        rejections.current.delete(primary.objectId);
        reportError(error, "result.reject_match");
        console.warn("Could not record the rejection", error);
        setSheet((current) =>
          current.open
            ? {
                ...current,
                notice: "Couldn’t record your feedback, but you can still pick a work.",
              }
            : current,
        );
        return null;
      },
    );
    const entry = { pending, consumed: false };
    rejections.current.set(primary.objectId, entry);
    rejection.current = entry;
  }

  function pickRunnerUp(candidate: ResultCandidate) {
    setSelection((current) => ({
      ...current,
      chosenObjectId: candidate.objectId,
    }));
    setSheet({ open: false });
    const pending = consumeRejection(rejection.current);
    rejection.current = undefined;
    if (!pending) return;
    void pending
      .then((feedbackId) => feedbackId && resolveWithRunnerUp(client, feedbackId, candidate.objectId))
      .catch((error: unknown) => {
        reportError(error, "result.resolve_feedback");
        console.warn("Could not resolve the rejection", error);
      });
  }

  const cropUri = capture ? captureFileUri(scanDisplayPath(capture.cropPath)) : undefined;
  const openMatch = useSheetMatchPreview({
    photo: () => cropUri,
    onChoose: pickRunnerUp,
    reopenSheet: () => setSheet((current) => ({ ...current, open: true })),
  });

  const saveProps = {
    saving,
    savedId,
    saveError,
    captureInput: capture ? { scanId, capture, view, contribution } : undefined,
    onSave: (draft: SnapshotDraft) => {
      void save({ scanId, capture, view, draft, contribution });
    },
    onViewSaved: () =>
      router.push({
        pathname: "/saved/[savedId]",
        params: { savedId: savedId ?? "" },
      }),
  };

  if (editingCrop && capture) {
    return <ScanCropEditor capture={capture} onCancel={() => setEditingCrop(false)} />;
  }
  if (labelCapture) {
    return (
      <ThemedView style={styles.container}>
        <LoadingRing accessibilityLabel="Opening your label…" style={{ flex: 1 }} />
      </ThemedView>
    );
  }
  const header = (
    <CardHeader
      cropUri={cropUri}
      artworkTitle={view.primary?.title}
      loading={!captureUpdatedAt && !captureError}
      kind={view.kind}
      probability={view.primary?.probability}
      source={namedBy}
      picked={view.picked}
      onNotRight={view.editable && view.primary && !saving && !savedId ? notRight : undefined}
      onEditDetails={namedBy && !saving && !savedId ? editConfirmed : undefined}
      onAdjustCrop={capture && !saving && !savedId ? adjustCrop : undefined}
    />
  );
  const photoError = captureError && (
    <ThemedText themeColor="error" accessibilityRole="alert">
      Couldn’t load the photo saved on this phone.
    </ThemedText>
  );
  return (
    <ThemedView style={styles.container}>
      {view.editable ? (
        <ResultCard
          key={`${view.kind}:${view.primary?.objectId ?? "none"}:${confirmed?.confirmedAt ?? ""}`}
          scanId={scanId}
          view={view}
          header={header}
          context={photoError}
          visit={capture && !savedId && <CaptureContextButton capture={capture} disabled={saving} variant="row" />}
          onRetryDocent={() => client.mutation(api.docent.retry, { scanId })}
          onOpenMatch={openMatch}
          onEdit={() => setHasEdits(true)}
          onLabel={openLabel}
          onEnterDetails={namedBy ? editConfirmed : enterDetails}
          savePhotoOnly={
            (view.kind === "unidentified" || view.kind === "soft") && !hasEdits && !selection.chosenObjectId
          }
          saveNotice={contribution && SHARING_NOTICE}
          onSavePhoto={() => {
            void save({ scanId, capture, draft: draftFromCandidate() });
          }}
          {...saveProps}
        />
      ) : (
        <SafeAreaScrollView
          contentInsetAdjustmentBehavior="automatic"
          automaticallyAdjustKeyboardInsets
          keyboardDismissMode="interactive"
          contentContainerStyle={styles.content}
        >
          {header}
          {capture && !savedId && <CaptureContextButton capture={capture} disabled={saving} />}
          {photoError}
          {view.kind === "loading" && (
            <View style={styles.loading} accessibilityState={{ busy: true }}>
              <LoadingRing color={Colors.light.accent} accessibilityLabel="Identifying…" />
            </View>
          )}
          {view.kind === "unsupported" && <UnsupportedCard {...saveProps} />}
          {view.kind === "failed" && (
            <>
              <FailedCard
                error={view.error}
                retrying={retrying}
                onRetry={
                  capture
                    ? () => {
                        if (retrying) return;
                        setRetrying(true);
                        setRetryError(undefined);
                        void markFailed(capture.localId, view.error ?? "Identification failed", scanId, owner)
                          .then(() => retryPendingScan(capture.localId))
                          .then(() =>
                            router.replace({
                              pathname: "/result/[scanId]",
                              params: { scanId: `local-${capture.localId}` },
                            }),
                          )
                          .catch((error: unknown) => {
                            reportError(error, "queue.retry");
                            setRetryError("Couldn’t retry. Your photo is still here.");
                          })
                          .finally(() => setRetrying(false));
                      }
                    : undefined
                }
              />
              {retryError && (
                <ThemedText themeColor="error" accessibilityRole="alert">
                  {retryError}
                </ThemedText>
              )}
              {capture && <SaveAnywayForm {...saveProps} compact />}
              <GalleryButton
                label="Scan another artwork"
                fullWidth
                onPress={() => {
                  router.dismissAll();
                  router.navigate("/(tabs)/(scan)/scan");
                }}
              />
            </>
          )}
        </SafeAreaScrollView>
      )}
      <NotRightSheet
        open={sheet.open}
        notice={sheet.notice}
        onDismiss={() => setSheet({ open: false })}
        runnerUps={view.runnerUps}
        onOpen={(candidate) => {
          setSheet((current) => ({ ...current, open: false }));
          openMatch(candidate, { inSheet: true });
        }}
        onLabel={openLabel}
        onManual={() => {
          setSheet({ open: false });
          enterDetails();
        }}
        onSavePhoto={
          capture
            ? () => {
                setSheet({ open: false });
                void save({ scanId, capture, draft: draftFromCandidate() });
              }
            : undefined
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 16,
    gap: Spacing.two,
  },
  loading: { gap: Spacing.two },
});
