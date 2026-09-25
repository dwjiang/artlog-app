import { useConvex } from "convex/react";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { LoadingRing } from "@/components/loading-ring";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Colors, Spacing } from "@/constants/theme";
import { markFailed, selectCaptureForScan } from "@/db/repos/pending-scans";
import { useScreenActive } from "@/hooks/use-screen-active";
import { useLocalOwner } from "@/lib/account/owner-store";
import { isLabelCapture } from "@/lib/capture/photo-draft";
import { captureFileUri, scanPreviewPath } from "@/lib/files/photos";
import { useMuseumSearch } from "@/lib/museum-search/use-museum-search";
import { reportError } from "@/lib/observability";
import { retryPendingScan } from "@/lib/queue/queue";
import { handOffLabelRejection, rejectMatch, resolveWithRunnerUp } from "@/lib/result/feedback";
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
import { CaptureCompletion } from "./capture-completion";
import { CaptureContextButton } from "./capture-context-button";
import { LocalScanScreen } from "./local-scan-screen";
import { CardHeader } from "./result/card-header";
import { MuseumSearchSection } from "./result/museum-search-section";
import { NotRightSheet } from "./result/not-right-sheet";
import { ResultCard } from "./result/result-card";
import { LABEL_BUTTON } from "./result/save-bar";
import { SearchConsentSheet } from "./result/search-consent-sheet";
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
  return <ScanResultScreen key={`${owner}:${scanId}:${manual}`} scanId={scanId as Id<"scans">} startManual={manual} />;
}

type Sheet = { open: boolean; notice?: string };

function ScanResultScreen({ scanId, startManual }: { scanId: Id<"scans">; startManual: boolean }) {
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
  const labelCapture = !startManual && !!capture && isLabelCapture(capture);
  const [selection, setSelection] = useState<ResultSelection>({});
  const [manual, setManual] = useState(startManual);
  const [searchConsent, setSearchConsent] = useState(false);
  const [retryError, setRetryError] = useState<string>();
  const [retrying, setRetrying] = useState(false);
  const [editingCrop, setEditingCrop] = useState(false);
  const [hasEdits, setHasEdits] = useState(false);
  const [sheet, setSheet] = useState<Sheet>({ open: false });
  const { saving, savedId, completion, error: saveError, save } = useSaveResult();
  // The latest "Not right?" rejection, so a pick made before the server answers still resolves it.
  const rejection = useRef<Promise<Id<"feedback"> | null>>(undefined);
  const view: ResultViewState = manual
    ? { kind: "unidentified", editable: true, runnerUps: [] }
    : toResultViewState(scan, selection);
  const showMuseumSearch = !manual && !hasEdits && !selection.chosenObjectId && !saving && !savedId && !saveError;
  const museumSearch = useMuseumSearch(
    scan instanceof Error ? undefined : scan,
    isActive && showMuseumSearch && !editingCrop,
  );

  useEffect(() => {
    if (isActive && labelCapture) {
      router.replace({ pathname: "/label/[scanId]", params: { scanId } });
    }
  }, [isActive, labelCapture, router, scanId]);

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
    const intent = museumSearch.flow || museumSearch.restoring || museumSearch.restoreError ? "capture" : "review";
    router.push({ pathname: "/label/[scanId]", params: { scanId, intent } });
  }

  function notRight() {
    const { primary } = view;
    if (!primary) return;
    setSelection((current) => ({
      ...current,
      rejectedObjectIds: [...(current.rejectedObjectIds ?? []), primary.objectId],
    }));
    setSheet({ open: true });
    rejection.current = rejectMatch(client, scanId, primary.objectId).then(
      (feedbackId) => {
        if (!feedbackId) {
          setSheet((current) =>
            current.open ? { ...current, notice: "This device can’t send feedback yet." } : current,
          );
        }
        return feedbackId;
      },
      (error: unknown) => {
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
  }

  function pickRunnerUp(candidate: ResultCandidate) {
    setSelection((current) => ({
      ...current,
      chosenObjectId: candidate.objectId,
    }));
    setSheet({ open: false });
    const pending = rejection.current;
    if (!pending) return;
    rejection.current = undefined;
    void pending
      .then((feedbackId) => feedbackId && resolveWithRunnerUp(client, feedbackId, candidate.objectId))
      .catch((error: unknown) => {
        reportError(error, "result.resolve_feedback");
        console.warn("Could not resolve the rejection", error);
      });
  }

  const saveProps = {
    saving,
    savedId,
    saveError,
    captureInput: capture ? { scanId, capture, view } : undefined,
    onSave: (draft: SnapshotDraft) => {
      void save({ scanId, capture, view, draft });
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
  if (completion) return <CaptureCompletion completion={completion} />;

  const showCard =
    view.editable
    && (!showMuseumSearch || (!museumSearch.flow && !museumSearch.restoring && !museumSearch.restoreError));
  const header = (
    <CardHeader
      cropUri={capture ? captureFileUri(scanPreviewPath(capture.cropPath)) : undefined}
      artworkTitle={view.primary?.title}
      loading={!captureUpdatedAt && !captureError}
      kind={view.kind}
      probability={view.primary?.probability}
      onNotRight={showCard && view.primary && !saving && !savedId ? notRight : undefined}
      onAdjustCrop={capture && !saving && !savedId ? adjustCrop : undefined}
    />
  );
  const photoError = captureError && (
    <ThemedText themeColor="error" accessibilityRole="alert">
      Couldn’t load the photo saved on this phone.
    </ThemedText>
  );
  const search =
    view.editable && showMuseumSearch ? (
      <MuseumSearchSection search={museumSearch} scanId={scanId} capture={capture} />
    ) : undefined;
  const searchIdle =
    !museumSearch.running && !museumSearch.flow && !museumSearch.restoring && !museumSearch.restoreError;
  return (
    <ThemedView style={styles.container}>
      {showCard ? (
        <ResultCard
          key={`${view.kind}:${view.primary?.objectId ?? "none"}:${manual}`}
          manual={manual}
          view={view}
          header={header}
          context={photoError}
          search={search}
          visit={capture && !savedId && <CaptureContextButton capture={capture} disabled={saving} variant="row" />}
          onSearchMuseum={
            showMuseumSearch && museumSearch.available && searchIdle
              ? () => {
                  if (museumSearch.consented) void museumSearch.search();
                  else setSearchConsent(true);
                }
              : undefined
          }
          onRetryDocent={() => client.mutation(api.docent.retry, { scanId })}
          onPick={pickRunnerUp}
          onEdit={() => setHasEdits(true)}
          onLabel={openLabel}
          savePhotoOnly={view.kind !== "confident" && !hasEdits && !selection.chosenObjectId}
          onSavePhoto={() => {
            void save({ scanId, capture, draft: draftFromCandidate() });
          }}
          {...saveProps}
        />
      ) : (
        <ScrollView
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
          {search}
          {view.editable && view.kind !== "confident" && (
            <GalleryButton label={LABEL_BUTTON} variant="filled" fullWidth disabled={saving} onPress={openLabel} />
          )}
        </ScrollView>
      )}
      <SearchConsentSheet
        open={searchConsent}
        onDismiss={() => setSearchConsent(false)}
        onGranted={() => {
          setSearchConsent(false);
          void museumSearch.search();
        }}
      />
      <NotRightSheet
        open={sheet.open}
        notice={sheet.notice}
        onDismiss={() => setSheet({ open: false })}
        runnerUps={view.runnerUps}
        onPick={pickRunnerUp}
        onLabel={openLabel}
        onManual={() => {
          setManual(true);
          setHasEdits(true);
          setSheet({ open: false });
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
