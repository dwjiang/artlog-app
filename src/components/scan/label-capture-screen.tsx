import * as Sentry from "@sentry/react-native";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useNetworkState } from "expo-network";
import { useRouter } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePhotoOutput } from "react-native-vision-camera";

import { ActionStack } from "@/components/action-stack";
import { GalleryButton } from "@/components/collection/gallery-button";
import { EmptyState } from "@/components/empty-state";
import { EmptyPaper } from "@/components/empty-state-art";
import { FormSkeleton } from "@/components/loading-skeleton";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Colors, Spacing } from "@/constants/theme";
import { MAX_LABEL_ATTEMPTS, setLabelPhoto, setQrUrl } from "@/db/repos/pending-scans";
import { useLocalOwner } from "@/lib/account/owner-store";
import { useQrScanner } from "@/lib/capture/use-qr-scanner";
import { persistLabelPhoto } from "@/lib/files/photos";
import { removeFile } from "@/lib/label/crop";
import { setFieldValue } from "@/lib/label/fields";
import { LabelFlowError, type LabelStage } from "@/lib/label/flow";
import { runLabelFlowForScan, type LabelSource } from "@/lib/label/label-deps";
import { useLabelCapture } from "@/lib/label/use-label-capture";
import { useLabelForm } from "@/lib/label/use-label-form";
import { isTransientError } from "@/lib/network-error";
import { isOffline } from "@/lib/network-state";
import { reportError } from "@/lib/observability";
import { discardPendingLabel, flushQueue, retryPendingLabel } from "@/lib/queue/queue";
import { useScan } from "@/lib/result/use-scan";

import type { Id } from "../../../convex/_generated/dataModel";
import type { ConfirmedFields, LabelFieldName, LabelFlowDisplay } from "../../../convex/lib/validators";
import { CameraPermission } from "./camera-permission";
import { CaptureControls, ShutterButton } from "./capture-controls";
import { ConfirmDetailsReview } from "./label/confirm-details-review";
import { ProgressSteps } from "./label/progress-steps";
import { OverlayCaption } from "./overlay-caption";
import { TapToFocusCamera } from "./tap-to-focus-camera";

export const QR_FOUND = "Found a QR code";
export const QUEUED_MESSAGE = "Saved — we’ll finish this when you’re back online";
export const QUEUED_ONLINE_MESSAGE = "Saved — we’ll finish this label shortly";
const MISSING_CAPTURE = "Your photo of this scan isn’t on this phone, so the label can’t be kept with it.";
export type LabelCaptureScreenProps = {
  scanId: string;
};

type Phase =
  | { kind: "capture"; restore?: boolean }
  | { kind: "running"; stage: LabelStage; qr: boolean }
  /** `confirmed` reopens details the owner already confirmed from this reading. */
  | { kind: "review"; flow: LabelFlowDisplay; confirmed?: ConfirmedFields }
  | { kind: "queued" }
  | { kind: "error"; message: string };

export function LabelCaptureScreen({ scanId }: LabelCaptureScreenProps) {
  const owner = useLocalOwner();
  // The router reuses this screen for a new scan id; the key drops the previous label's phase and form.
  return <LabelCapture key={`${owner}:${scanId}`} scanId={scanId} />;
}

function LabelCapture({ scanId }: LabelCaptureScreenProps) {
  const router = useRouter();
  const isFocused = useIsFocused();
  const network = useNetworkState();
  const { bottom } = useSafeAreaInsets();
  const [appState, setAppState] = useState(AppState.currentState);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string>();
  const [phase, setPhase] = useState<Phase>({ kind: "capture" });
  const [busy, setBusy] = useState(false);
  const capture = useLabelCapture(scanId);
  const mounted = useRef(true);
  const inFlight = useRef(false);

  // Queued captures carry a local id until identified: their label waits on the row for the queue.
  const localId = scanId.startsWith("local-") ? scanId.slice("local-".length) : undefined;
  const remoteScanId = localId ? (capture?.scanId ?? undefined) : (scanId as Id<"scans">);
  const scan = useScan(remoteScanId);
  const storedFlow = scan && !(scan instanceof Error) ? scan.labelFlow : undefined;
  const storedConfirmed = scan && !(scan instanceof Error) ? scan.confirmed : undefined;
  const {
    form,
    setForm,
    error: formError,
    retry: retryForm,
  } = useLabelForm(
    remoteScanId,
    phase.kind === "review" ? phase.flow : undefined,
    phase.kind === "review" ? phase.confirmed : undefined,
  );
  const pendingLabel = !!(capture?.labelPhotoPath || capture?.qrUrl);
  const offline = isOffline(network);
  const storeOnly = !remoteScanId || offline;
  const restoring = !!remoteScanId && !storeOnly && scan === undefined;
  const active = isFocused && appState === "active" && phase.kind === "capture" && !restoring && !pendingLabel;
  const photoOutput = usePhotoOutput({ containerFormat: "jpeg", quality: 1 });

  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener("change", setAppState);
    return () => {
      mounted.current = false;
      subscription.remove();
    };
  }, []);

  if (phase.kind === "queued" || phase.kind === "capture") {
    if (pendingLabel) {
      if (phase.kind === "capture") setPhase({ kind: "queued" });
    } else if (
      (phase.kind === "queued" || phase.restore !== false)
      && storedFlow?.stage === "verified"
      && storedFlow.moderation === "clear"
    ) {
      setPhase({
        kind: "review",
        flow: storedFlow,
        confirmed: storedConfirmed?.source === "label" ? storedConfirmed.fields : undefined,
      });
    }
  }

  async function queueLabel(label: { photoUri?: string; qrUrl?: string }) {
    if (!capture) {
      if (mounted.current) {
        setPhase({ kind: "error", message: MISSING_CAPTURE });
      }
      return;
    }
    if (label.photoUri) {
      await setLabelPhoto(
        capture.localId,
        await persistLabelPhoto({
          localId: capture.localId,
          photoUri: label.photoUri,
        }),
        capture.owner,
      );
    }
    if (label.qrUrl) {
      await setQrUrl(capture.localId, label.qrUrl, capture.owner);
    }
    if (mounted.current) setPhase({ kind: "queued" });
    void flushQueue();
  }

  async function runFlow(source: LabelSource) {
    if (!remoteScanId) return;
    const qr = !!source.qrUrl;
    let keepSource = false;
    setPhase({ kind: "running", stage: qr ? "qr" : "read", qr });
    try {
      const flow = await runLabelFlowForScan(remoteScanId, source, (stage) => {
        if (mounted.current) {
          setPhase((current) => (current.kind === "running" ? { ...current, stage } : current));
        }
      });
      if (!mounted.current) return;
      setPhase({ kind: "review", flow });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (error) {
      reportError(error, "label.verify");
      console.warn("Label flow failed", error);
      if (isTransientError(error instanceof LabelFlowError ? (error.cause ?? error) : error)) {
        keepSource = true;
        await queueLabel({
          photoUri: source.labelPhotoUri,
          qrUrl: source.qrUrl,
        });
        return;
      }
      if (mounted.current) {
        setPhase({
          kind: "error",
          message: error instanceof LabelFlowError ? error.message : "Couldn’t verify the label right now",
        });
      }
    } finally {
      if (!keepSource && source.labelPhotoUri) removeFile(source.labelPhotoUri);
    }
  }

  async function handleLabel(
    getLabel: () => Promise<{ photoUri?: string; qrUrl?: string } | null>,
    failureMessage?: string,
  ) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const label = await getLabel();
      if (!label) return;
      if (!mounted.current) {
        if (label.photoUri) removeFile(label.photoUri);
        return;
      }
      if (storeOnly) await queueLabel(label);
      else await runFlow({ labelPhotoUri: label.photoUri, qrUrl: label.qrUrl });
    } catch (error) {
      reportError(error, "label.capture");
      console.warn("Could not keep the label", error);
      if (mounted.current) {
        setPhase({
          kind: "error",
          message: failureMessage ?? (error instanceof Error ? error.message : "Couldn’t keep the label. Try again."),
        });
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  // The scanner keeps one stable callback; the ref hands it the latest capture and reachability.
  const latestHandleLabel = useRef(handleLabel);
  useEffect(() => {
    latestHandleLabel.current = handleLabel;
  });
  const onCode = useCallback((url: string) => {
    void latestHandleLabel.current(async () => ({ qrUrl: url }));
  }, []);
  const qrOutput = useQrScanner(active && !busy, onCode);
  const outputs = useMemo(() => (qrOutput ? [photoOutput, qrOutput] : [photoOutput]), [photoOutput, qrOutput]);

  function takePhoto() {
    if (!active || !cameraReady || busy) return;
    void Haptics.selectionAsync().catch(() => {});
    void handleLabel(async () => {
      const { filePath } = await photoOutput.capturePhotoToFile({}, {});
      return { photoUri: `file://${filePath}` };
    }, "Couldn’t take the photo. Try again.");
  }

  function importPhoto() {
    if (busy) return;
    void handleLabel(async () => {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 1,
      });
      if (result.canceled || !result.assets[0]) return null;
      return { photoUri: result.assets[0].uri };
    });
  }

  async function retakeLabel() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      if (capture) await discardPendingLabel(capture.localId);
      if (mounted.current) setPhase({ kind: "capture", restore: false });
    } catch (error) {
      reportError(error, "label.discard");
      console.warn("Could not discard the pending label", error);
      if (mounted.current) {
        setPhase({
          kind: "error",
          message: "Couldn’t replace the label. Try again.",
        });
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function retryLabel() {
    if (!capture || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await retryPendingLabel(capture.localId);
    } catch (error) {
      reportError(error, "label.retry");
      if (mounted.current) {
        setPhase({
          kind: "error",
          message: "Couldn’t retry this label. Your scan and label are still on this phone.",
        });
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function onChange(name: LabelFieldName, value: string) {
    setForm((current) => current && setFieldValue(current, name, value));
  }

  if (phase.kind === "running") {
    return (
      <ThemedView style={styles.container}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.content}
          accessibilityState={{ busy: true }}
        >
          <ThemedText type="subtitle">{phase.qr ? QR_FOUND : "Reading the label"}</ThemedText>
          <ProgressSteps stage={phase.stage} qr={phase.qr} />
        </ScrollView>
      </ThemedView>
    );
  }

  if (phase.kind === "queued") {
    if (!pendingLabel && storedFlow?.moderation === "flagged") {
      return (
        <StateCard title={new LabelFlowError("label_flagged").message}>
          <GalleryButton
            label="Retake label"
            variant="filled"
            fullWidth
            disabled={busy}
            onPress={() => {
              void retakeLabel();
            }}
          />
        </StateCard>
      );
    }
    if (!pendingLabel && scan && !(scan instanceof Error) && scan.outcome === "confident") {
      return (
        <StateCard title="Painting identified">
          <GalleryButton
            label="View result"
            variant="filled"
            fullWidth
            onPress={() =>
              router.replace({
                pathname: "/result/[scanId]",
                params: { scanId: scan.scanId },
              })
            }
          />
        </StateCard>
      );
    }
    if (capture?.lastError && capture.attempts >= MAX_LABEL_ATTEMPTS) {
      return (
        <StateCard title={new LabelFlowError(capture.lastError).message}>
          <GalleryButton
            label="Try again"
            variant="filled"
            fullWidth
            disabled={busy}
            busy={busy}
            onPress={() => {
              void retryLabel();
            }}
          />
          <GalleryButton
            label="Retake label"
            variant="outlined"
            fullWidth
            disabled={busy}
            onPress={() => {
              void retakeLabel();
            }}
          />
        </StateCard>
      );
    }
    return (
      <StateCard
        title={offline ? QUEUED_MESSAGE : QUEUED_ONLINE_MESSAGE}
        detail="Your scan and this label are queued together; we’ll identify and read them in order."
      >
        <GalleryButton label="Back to the scan" variant="filled" fullWidth onPress={() => router.back()} />
      </StateCard>
    );
  }

  if (phase.kind === "capture" && restoring) {
    return (
      <StateCard>
        <FormSkeleton label="Loading the label…" />
      </StateCard>
    );
  }

  if (phase.kind === "capture" && phase.restore !== false && scan instanceof Error && !storeOnly) {
    return (
      <StateCard
        title="Couldn’t load this label"
        detail="Your captured photo stays on this phone. Capture the label again to continue."
      >
        <GalleryButton
          label="Capture label"
          variant="filled"
          fullWidth
          onPress={() => setPhase({ kind: "capture", restore: false })}
        />
      </StateCard>
    );
  }

  if (phase.kind === "error") {
    return (
      <StateCard title="We couldn’t read that label." detail={phase.message} illustrated>
        <ActionStack
          textActions={
            <GalleryButton
              label="Enter details myself"
              fullWidth
              onPress={() =>
                // A scan still queued on this phone has no server scan to confirm, so its card keeps typed details.
                remoteScanId
                  ? router.replace({ pathname: "/enter-details/[scanId]", params: { scanId: remoteScanId } })
                  : router.replace({ pathname: "/result/[scanId]", params: { scanId, edit: "1" } })
              }
            />
          }
        >
          <GalleryButton
            label="Retake label"
            variant="filled"
            fullWidth
            onPress={() => setPhase({ kind: "capture", restore: false })}
          />
        </ActionStack>
      </StateCard>
    );
  }

  if (phase.kind === "review" && !form) {
    return (
      <StateCard title={formError?.message}>
        {!formError && <FormSkeleton label="Loading the label…" />}
        {formError && <GalleryButton label="Try again" variant="filled" fullWidth onPress={retryForm} />}
      </StateCard>
    );
  }

  if (phase.kind === "review" && form) {
    return (
      <ConfirmDetailsReview
        scanId={remoteScanId}
        sourceKind="label"
        capture={capture}
        form={form}
        source={{
          label: phase.flow.sourceUrl ? "Read from the museum page" : "Read from your photo",
          url: phase.flow.sourceUrl,
        }}
        warnings={phase.flow.warnings}
        formKey={phase.flow.updatedAt}
        onChange={onChange}
      />
    );
  }

  const canCapture = active && cameraReady && !busy;
  return (
    <View style={styles.camera}>
      <CameraPermission onImport={importPhoto} loading={active && !cameraReady && !cameraError && !busy}>
        <Sentry.Mask style={StyleSheet.absoluteFill}>
          <TapToFocusCamera
            device="back"
            orientationSource="interface"
            resizeMode="cover"
            isActive={active}
            outputs={outputs}
            allowHapticsAndSystemSoundsPlayback
            onStarted={() => {
              setCameraReady(true);
              setCameraError(undefined);
            }}
            onStopped={() => setCameraReady(false)}
            onError={(error) => {
              reportError(error, "camera.start", { data: { screen: "label" } });
              setCameraReady(false);
              setCameraError("Could not start the camera. You can import a label photo.");
            }}
          />
        </Sentry.Mask>
        <ScrollView
          pointerEvents="box-none"
          style={StyleSheet.absoluteFill}
          contentInsetAdjustmentBehavior="never"
          contentContainerStyle={[styles.cameraOverlay, { paddingBottom: bottom + Spacing.three }]}
        >
          <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.guideArea}
          >
            <View style={styles.guide}>
              <View style={[styles.guideCorner, styles.topLeft]} />
              <View style={[styles.guideCorner, styles.topRight]} />
              <View style={[styles.guideCorner, styles.bottomLeft]} />
              <View style={[styles.guideCorner, styles.bottomRight]} />
            </View>
          </View>
          <View pointerEvents="box-none" style={styles.cameraBottom}>
            {cameraError ? (
              <View accessible accessibilityRole="alert">
                <OverlayCaption>{cameraError}</OverlayCaption>
              </View>
            ) : (
              <View accessibilityLiveRegion="polite">
                <OverlayCaption
                  hint={
                    busy
                      ? undefined
                      : offline
                        ? "No signal. We’ll keep the label with your scan and finish when you’re back online."
                        : "Tap the shutter to read the text. QR codes scan automatically."
                  }
                >
                  {busy ? "Reading the label" : "Fill the frame with the museum label."}
                </OverlayCaption>
              </View>
            )}
            <CaptureControls importLabel="Import a label photo" importDisabled={busy || !active} onImport={importPhoto}>
              <ShutterButton
                label="Read label"
                hint="Takes a photo of the museum label to read its text"
                disabled={!canCapture}
                busy={busy}
                onPress={takePhoto}
              />
            </CaptureControls>
          </View>
        </ScrollView>
      </CameraPermission>
    </View>
  );
}

function StateCard({
  title,
  detail,
  children,
  illustrated = false,
}: {
  title?: string;
  detail?: string;
  children?: React.ReactNode;
  illustrated?: boolean;
}) {
  return (
    <ThemedView style={styles.container}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        {illustrated && title ? (
          <EmptyState inset={false} visual={<EmptyPaper kind="label" />} title={title} detail={detail ?? ""}>
            {children}
          </EmptyState>
        ) : (
          <>
            {title && <ThemedText type="title">{title}</ThemedText>}
            {detail && <ThemedText themeColor="textSecondary">{detail}</ThemedText>}
            {children}
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, gap: Spacing.three },
  camera: { flex: 1, backgroundColor: Colors.light.background },
  cameraOverlay: {
    pointerEvents: "box-none",
    flexGrow: 1,
    paddingHorizontal: Spacing.content,
    paddingTop: Spacing.four,
    gap: Spacing.four,
  },
  cameraBottom: { gap: Spacing.three },
  guideArea: { flexGrow: 1, justifyContent: "center" },
  guide: { width: "100%", aspectRatio: 1.5 },
  guideCorner: {
    position: "absolute",
    width: Spacing.four,
    height: Spacing.four,
    borderColor: Colors.light.overlayText,
  },
  topLeft: { top: 0, left: 0, borderTopWidth: 2, borderLeftWidth: 2 },
  topRight: { top: 0, right: 0, borderTopWidth: 2, borderRightWidth: 2 },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 2, borderLeftWidth: 2 },
  bottomRight: { bottom: 0, right: 0, borderBottomWidth: 2, borderRightWidth: 2 },
});
