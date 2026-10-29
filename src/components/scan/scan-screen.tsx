import * as Sentry from "@sentry/react-native";
import { useLocalSearchParams, useNavigation, type NativeStackNavigationProp } from "expo-router";
import { useIsFocused, type ParamListBase } from "expo-router/react-navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { AppState, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, { Keyframe, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useOrientation, usePhotoOutput } from "react-native-vision-camera";

import { MINI_PLAYER_HEIGHT } from "@/components/audio/mini-player";
import { GalleryButton } from "@/components/collection/gallery-button";
import { Gallery, Spacing } from "@/constants/theme";
import { useHasListeningTrack } from "@/lib/audio/use-listening";
import { findDemoVideo } from "@/lib/capture/demo-viewfinder";
import { MotionSampler, type MotionReader } from "@/lib/capture/device-motion";
import { useCapture } from "@/lib/capture/use-capture";
import { useRectDetector } from "@/lib/capture/use-rect-detector";
import { useUprightPhoto } from "@/lib/capture/use-upright-photo";
import { isJudgesDemo } from "@/lib/judges-demo";
import { reportError } from "@/lib/observability";
import { useHorizontalSafeAreaPadding } from "@/lib/ui/safe-area";
import { useLiftToasts } from "@/lib/ui/toast";
import { useVenue } from "@/lib/venue/use-venue";

import type { RectDetection } from "../../../modules/vision-rect/src";
import { CameraPermission } from "./camera-permission";
import { CaptureControls } from "./capture-controls";
import { CaptureFeedback, CaptureOutline, CaptureShutter } from "./capture-feedback";
import { CaptureReveal } from "./capture-reveal";
import { CaptureVisitPill } from "./capture-visit-pill";
import { DemoPhotoSheet, type DemoPhotoSheetHandle } from "./demo-photo-sheet";
import { DemoViewfinder, type DemoViewfinderHandle } from "./demo-viewfinder";
import { DetectionLog, DevTimings } from "./dev-timings";
import { OverlayCaption } from "./overlay-caption";
import { QueueBadge } from "./queue-badge";
import { TapToFocusCamera } from "./tap-to-focus-camera";
import { VenuePill } from "./venue-pill";

// A failed capture's caption shakes once as it appears, in the frame its error haptic plays.
const FAILURE_SHAKE = new Keyframe({
  0: { transform: [{ translateX: 0 }] },
  20: { transform: [{ translateX: -8 }] },
  40: { transform: [{ translateX: 7 }] },
  60: { transform: [{ translateX: -5 }] },
  80: { transform: [{ translateX: 3 }] },
  100: { transform: [{ translateX: 0 }] },
})
  .duration(360)
  .reduceMotion(ReduceMotion.System);

export function ScanScreen() {
  const listening = useHasListeningTrack();
  const { fontScale } = useWindowDimensions();
  const stackRetryActions = fontScale > 1.4;
  // The camera is the only place the museum sheet opens on its own: once per undecided spot, when the camera comes up.
  const { status: venueStatus, options: venueOptions, promptChooser } = useVenue();
  const audioInset = listening ? MINI_PLAYER_HEIGHT + 16 : 0;
  const isFocused = useIsFocused();
  const { visitId } = useLocalSearchParams<{ visitId?: string }>();
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const [appState, setAppState] = useState(AppState.currentState);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string>();
  // The judges' demo build has no camera the app can open, so a gallery video stands in for it; null until loaded.
  const [demoVideo] = useState(() => (isJudgesDemo() ? (findDemoVideo() ?? null) : undefined));
  const [demoTargeted, setDemoTargeted] = useState(false);
  const demoViewfinder = useRef<DemoViewfinderHandle>(null);
  const demoPhotos = useRef<DemoPhotoSheetHandle>(null);
  const [preview, setPreview] = useState({ width: 0, height: 0 });
  const [controls, setControls] = useState({ top: 0, bottom: 0 });
  // Native tabs give each tab its own safe area, which already ends above the tab bar and any bottom accessory.
  const { top, bottom } = useSafeAreaInsets();
  const overlayPadding = useHorizontalSafeAreaPadding(styles.overlay);
  const topLayerPadding = useHorizontalSafeAreaPadding(styles.topLayer);
  const controlsBottom = bottom + Spacing.three;
  const revealInsets = useMemo(
    () => ({
      top: top + Spacing.three + controls.top + Spacing.four,
      bottom: controlsBottom + controls.bottom + Spacing.four,
    }),
    [top, controlsBottom, controls],
  );
  useLiftToasts(controls.bottom ? controlsBottom + controls.bottom : undefined, isFocused);
  const active = isFocused && appState === "active";
  const photoOutput = usePhotoOutput({ containerFormat: "jpeg", quality: 1 });
  // The preview turns with the interface, which iOS 27 may rotate even though the app prefers portrait.
  const orientation = useOrientation("interface") ?? "up";
  const cameraPhoto = useUprightPhoto(photoOutput, orientation, active);
  const takePhoto = demoVideo ? () => demoViewfinder.current!.takePhoto() : cameraPhoto;
  const capture = useCapture({
    active,
    focused: isFocused,
    visitLocalId: visitId,
    view: preview,
    onVisitUnavailable: () => navigation.setParams({ visitId: undefined }),
  });
  const { phase, occupied, source, message, rearm } = capture.state;
  // A visit chosen in link-artwork covers one capture: it ends at the result or when another tab is selected.
  // Sheets and the visit's own screen sit above the tab and keep it.
  useEffect(() => {
    if (visitId && phase === "result") {
      navigation.setParams({ visitId: undefined });
    }
  }, [navigation, phase, visitId]);
  useEffect(() => {
    if (!visitId) return;
    return navigation.getParent()?.addListener("state", ({ data }) => {
      if (data.state.routes[data.state.index]?.name !== "(scan)") {
        navigation.setParams({ visitId: undefined });
      }
    });
  }, [navigation, visitId]);
  const searching = !occupied && (phase === "searching" || (phase === "retry" && source !== "library"));
  const detecting = active && cameraReady && searching;
  const { resetDetection } = capture.controller;
  useEffect(() => {
    if (!detecting) resetDetection();
  }, [detecting, resetDetection]);
  const [detectionLog] = useState(() => new DetectionLog());
  const readMotion = useRef<MotionReader | undefined>(undefined);
  const setMotionReader = useCallback((read: MotionReader | undefined) => {
    readMotion.current = read;
  }, []);
  // The demo viewfinder's video frames carry no camera time, so they are timed on arrival.
  const onDetection = (detection: RectDetection, at = performance.now()) => {
    const attempt = capture.controller.observe(detection, preview, at, readMotion.current?.());
    detectionLog.record(detection, capture.controller.getFeedback());
    if (attempt) {
      void capture.captureAutomatically(attempt, takePhoto);
    }
  };
  const frameOutput = useRectDetector(detecting, orientation, onDetection, resetDetection);
  const outputs = useMemo(() => [photoOutput, frameOutput], [photoOutput, frameOutput]);
  const busy = occupied || !["searching", "retry"].includes(phase);
  const cameraActive = active && (searching || (phase === "capturing" && source === "camera"));
  const failedImport = phase === "retry" && source === "library";
  const retryHint = failedImport
    ? undefined
    : rearm === "shutter"
      ? "Reframe the artwork and tap the shutter."
      : "Move the camera to reframe, then hold steady.";
  const shutterDisabled = busy || !active || !cameraReady || (!!demoVideo && !demoTargeted);
  const viewfinderError = demoVideo === null ? "No sample video is loaded. You can import a photo." : cameraError;
  const { endResultTransition } = capture;
  // The demo's photo picker offers its gallery stills and the judge's uploads instead of the phone's library.
  const importPhoto = () => {
    void capture.importPhoto(demoVideo === undefined ? undefined : () => demoPhotos.current!.pick());
  };

  useEffect(
    () =>
      navigation.addListener("transitionEnd", ({ data }) => {
        if (data.closing) endResultTransition();
      }),
    [navigation, endResultTransition],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", setAppState);
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    // Opening a sheet takes focus away and cancels an unfinished capture. The judges' demo leaves the museum to the
    // venue pill, so the viewfinder is ready on arrival.
    if (active && searching && !visitId && !isJudgesDemo()) promptChooser();
  }, [active, searching, visitId, venueStatus, venueOptions, promptChooser]);

  const renderOverlay = (cameraAvailable: boolean) => (
    <View
      pointerEvents="box-none"
      style={[
        styles.overlay,
        overlayPadding,
        { paddingTop: top + Spacing.three + controls.top + Spacing.four, paddingBottom: controlsBottom },
      ]}
    >
      <ControlsFrame setControls={setControls}>
        <DevTimings timings={busy ? undefined : capture.timings} detection={detecting ? detectionLog : undefined} />
        {message ? (
          <Animated.View entering={FAILURE_SHAKE} accessible accessibilityRole="alert">
            <OverlayCaption hint={retryHint}>{message}</OverlayCaption>
          </Animated.View>
        ) : (
          <CaptureFeedback controller={capture.controller} detecting={detecting} busy={busy} />
        )}
        {failedImport ? (
          <View style={[styles.retryActions, stackRetryActions && styles.stackedRetryActions]}>
            <GalleryButton
              label="Choose another photo"
              variant="filled"
              fullWidth={stackRetryActions}
              onPress={importPhoto}
            />
            {cameraAvailable && (
              <GalleryButton
                label="Use camera"
                variant="filled"
                fullWidth={stackRetryActions}
                onPress={capture.useCamera}
              />
            )}
          </View>
        ) : (
          <CaptureControls
            importLabel={cameraAvailable ? "Import" : "Import a photo"}
            importDisabled={busy || !active}
            onImport={importPhoto}
          >
            {cameraAvailable && (
              <CaptureShutter
                controller={capture.controller}
                disabled={shutterDisabled}
                busy={busy}
                captured={busy && source === "camera"}
                detecting={detecting}
                onPress={() => {
                  void capture.captureManually(takePhoto);
                }}
              />
            )}
          </CaptureControls>
        )}
      </ControlsFrame>
    </View>
  );

  return (
    <View
      style={styles.container}
      onLayout={({ nativeEvent: { layout } }) => setPreview({ width: layout.width, height: layout.height })}
    >
      {active && cameraReady && <MotionSampler onReader={setMotionReader} />}
      {demoVideo !== undefined ? (
        <>
          {demoVideo && (
            <DemoViewfinder
              ref={demoViewfinder}
              video={demoVideo}
              active={cameraActive}
              searching={active && searching}
              onTargetChange={setDemoTargeted}
              onReady={() => {
                setCameraReady(true);
                setCameraError(undefined);
              }}
              onDetection={onDetection}
              onError={(message) => {
                reportError(new Error(message), "camera.start", { data: { screen: "scan", source: "demo-video" } });
                setCameraReady(false);
                setCameraError("Could not play the sample video. You can import a photo.");
              }}
            />
          )}
          <DemoPhotoSheet ref={demoPhotos} />
          {detecting && <CaptureOutline controller={capture.controller} preview={preview} />}
          {renderOverlay(true)}
        </>
      ) : (
        <CameraPermission
          bottomInset={audioInset}
          onImport={importPhoto}
          fallback={source === "library" ? renderOverlay(false) : undefined}
          loading={cameraActive && !cameraReady && !cameraError}
        >
          <Sentry.Mask style={StyleSheet.absoluteFill}>
            <TapToFocusCamera
              device="back"
              orientationSource="custom"
              resizeMode="cover"
              isActive={cameraActive}
              outputs={outputs}
              allowHapticsAndSystemSoundsPlayback
              onStarted={() => {
                setCameraReady(true);
                setCameraError(undefined);
              }}
              onStopped={() => setCameraReady(false)}
              onError={(error) => {
                reportError(error, "camera.start", { data: { screen: "scan" } });
                setCameraReady(false);
                setCameraError("Could not start the camera. You can import a photo.");
              }}
            />
          </Sentry.Mask>
          {detecting && <CaptureOutline controller={capture.controller} preview={preview} />}
          {renderOverlay(true)}
        </CameraPermission>
      )}
      {/* The venue and queue entry points have no other home, so they stay above the permission invitation as well. */}
      <View pointerEvents="box-none" style={[styles.topLayer, topLayerPadding, { paddingTop: top + Spacing.three }]}>
        <View
          pointerEvents="box-none"
          style={styles.top}
          onLayout={({ nativeEvent: { layout } }) => setControls((value) => ({ ...value, top: layout.height }))}
        >
          <View pointerEvents="box-none" style={styles.topRow}>
            {visitId ? <CaptureVisitPill visitId={visitId} /> : <VenuePill />}
            <QueueBadge />
          </View>
          {viewfinderError && !message && !busy && (
            <View accessible accessibilityRole="alert">
              <OverlayCaption>{viewfinderError}</OverlayCaption>
            </View>
          )}
        </View>
      </View>
      {capture.presentation && (
        <CaptureReveal
          key={capture.presentation.attempt.id}
          presentation={capture.presentation}
          insets={revealInsets}
          onComplete={() => capture.completeReveal(capture.presentation!.attempt)}
        />
      )}
    </View>
  );
}

/** The bottom controls, measured for toasts to float above; when the permission page replaces them, toasts drop back. */
function ControlsFrame({
  setControls,
  children,
}: {
  setControls: Dispatch<SetStateAction<{ top: number; bottom: number }>>;
  children: ReactNode;
}) {
  useEffect(() => () => setControls((value) => ({ ...value, bottom: 0 })), [setControls]);
  return (
    <View
      pointerEvents="box-none"
      style={styles.bottom}
      onLayout={({ nativeEvent: { layout } }) => setControls((value) => ({ ...value, bottom: layout.height }))}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Gallery.paper },
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: Spacing.content,
  },
  topLayer: {
    position: "absolute",
    zIndex: 1,
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.content,
  },
  top: { gap: Spacing.three },
  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  bottom: { gap: Spacing.three },
  retryActions: { flexDirection: "row", gap: Spacing.three },
  stackedRetryActions: { flexDirection: "column" },
});
