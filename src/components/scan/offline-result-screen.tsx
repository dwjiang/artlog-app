import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { ThemedView } from "@/components/themed-view";
import type { PendingScan } from "@/db/schema";
import { captureFileUri, scanPreviewPath } from "@/lib/files/photos";
import { draftFromCandidate } from "@/lib/result/snapshot";
import type { ResultCandidate, ResultViewState } from "@/lib/result/state";
import { useSaveResult } from "@/lib/result/use-save-result";
import type { OfflineResult } from "@/shared/offline/types";

import { CaptureCompletion } from "./capture-completion";
import { CaptureContextButton } from "./capture-context-button";
import { CardHeader } from "./result/card-header";
import { NotRightSheet } from "./result/not-right-sheet";
import { ResultCard } from "./result/result-card";
import { ScanCropEditor } from "./scan-crop-editor";

export function OfflineResultScreen({
  capture,
  result,
  onViewResult,
}: {
  capture: PendingScan;
  result: OfflineResult;
  onViewResult?: () => void;
}) {
  const router = useRouter();
  const [hasEdits, setHasEdits] = useState(false);
  const [manual, setManual] = useState(false);
  const [editingCrop, setEditingCrop] = useState(false);
  const [chosen, setChosen] = useState<ResultCandidate>();
  const [notRight, setNotRight] = useState(false);
  const saved = useSaveResult();
  const view: ResultViewState = manual
    ? { kind: "unidentified", editable: true, runnerUps: [] }
    : {
        kind: chosen ? "soft" : "confident",
        primary: chosen ?? result.best,
        runnerUps: (result.runnerUps ?? []).filter((candidate) => candidate.objectId !== chosen?.objectId),
        docent: chosen ? undefined : result.docent,
        factSheet: chosen ? undefined : result.factSheet,
        editable: true,
      };
  const onLabel = () => {
    setNotRight(false);
    router.push({
      pathname: "/label/[scanId]",
      params: { scanId: `local-${capture.localId}`, offline: "1" },
    });
  };
  const adjustCrop = () => {
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
  };
  // The queue identified this capture after the local match; the server's card may name a different work.
  const viewResult =
    onViewResult
    && (() => {
      if (hasEdits) {
        Alert.alert(
          "Discard your edits?",
          "Save your entry first to keep these details, or discard them to view the online result.",
          [
            { text: "Keep editing", style: "cancel" },
            {
              text: "Discard edits",
              style: "destructive",
              onPress: onViewResult,
            },
          ],
        );
      } else {
        onViewResult();
      }
    });
  if (editingCrop) {
    return <ScanCropEditor capture={capture} onCancel={() => setEditingCrop(false)} />;
  }
  if (saved.completion) {
    return <CaptureCompletion completion={saved.completion} onViewResult={onViewResult} />;
  }
  return (
    <ThemedView style={{ flex: 1 }}>
      <ResultCard
        key={`${manual}:${view.primary?.objectId}`}
        manual={manual}
        prosePending={false}
        view={view}
        saving={saved.saving}
        savedId={saved.savedId}
        saveError={saved.error}
        captureInput={{ capture, view }}
        header={
          <CardHeader
            cropUri={captureFileUri(scanPreviewPath(capture.cropPath))}
            artworkTitle={view.primary?.title}
            kind={view.kind}
            probability={view.primary?.probability}
            onNotRight={!saved.saving && !saved.savedId && view.primary ? () => setNotRight(true) : undefined}
            onAdjustCrop={!saved.saving && !saved.savedId ? adjustCrop : undefined}
          />
        }
        context={
          viewResult
          && !saved.savedId && (
            <GalleryButton
              label="View the online result"
              icon="antenna.radiowaves.left.and.right"
              onPress={viewResult}
              disabled={saved.saving}
            />
          )
        }
        visit={!saved.savedId && <CaptureContextButton capture={capture} disabled={saved.saving} variant="row" />}
        onLabel={onLabel}
        onPick={setChosen}
        onEdit={() => setHasEdits(true)}
        savePhotoOnly={manual && !hasEdits}
        onSave={(draft) => {
          void saved.save({ capture, view, draft });
        }}
        onSavePhoto={() => {
          void saved.save({ capture, draft: draftFromCandidate() });
        }}
        onViewSaved={() =>
          router.push({
            pathname: "/saved/[savedId]",
            params: { savedId: saved.savedId ?? "" },
          })
        }
      />
      <NotRightSheet
        open={notRight}
        onDismiss={() => setNotRight(false)}
        runnerUps={view.runnerUps}
        onPick={(candidate) => {
          setChosen(candidate);
          setNotRight(false);
        }}
        onLabel={onLabel}
        onManual={() => {
          setManual(true);
          setHasEdits(true);
          setNotRight(false);
        }}
        onSavePhoto={() => {
          setNotRight(false);
          void saved.save({ capture, draft: draftFromCandidate() });
        }}
      />
    </ThemedView>
  );
}
