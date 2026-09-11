import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useIsFocused } from 'expo-router/react-navigation';
import { useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, usePhotoOutput } from 'react-native-vision-camera';

import { CameraPermission } from './camera-permission';
import { DevTimings } from './dev-timings';
import { OverlayCaption } from './overlay-caption';
import { QueueBadge } from './queue-badge';
import { RetakeBanner } from './retake-banner';
import { VenuePill } from './venue-pill';
import { GuidanceLabel, ViewfinderOverlay } from './viewfinder-overlay';
import { GlassSurface } from '@/components/glass-surface';
import { BottomTabInset, Colors, Spacing } from '@/constants/theme';
import { useCapture } from '@/lib/capture/use-capture';
import { useRectDetector } from '@/lib/capture/use-rect-detector';
import { resolveVenueForScan } from '@/lib/venue/use-venue';

const SHUTTER_SIZE = 72;
const SHUTTER_RING = 4;
const SHUTTER_GAP = 3;
const IMPORT_SIZE = 56;

export function ScanScreen() {
  const isFocused = useIsFocused();
  const [appState, setAppState] = useState(AppState.currentState);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string>();
  const { top, bottom } = useSafeAreaInsets();
  const active = isFocused && appState === 'active';
  const photoOutput = usePhotoOutput({ containerFormat: 'jpeg', quality: 1 });
  const detector = useRectDetector(active);
  const outputs = useMemo(() => [photoOutput, detector.frameOutput], [photoOutput, detector.frameOutput]);
  const { capture, importPhoto, busy, message, timings, clearMessage } = useCapture();
  const canCapture = active && cameraReady && !busy;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (detector.ready) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [detector.ready]);

  function takePhoto() {
    if (!canCapture) return;
    void Haptics.selectionAsync().catch(() => {});
    void capture(async () => {
      const capturedAt = Date.now();
      const quad = detector.getCaptureQuad();
      const { filePath } = await photoOutput.capturePhotoToFile({}, {});
      if (__DEV__) console.debug('Captured photo', filePath);
      const context = await resolveVenueForScan();
      return { photoUri: `file://${filePath}`, quad, source: 'camera', capturedAt, ...context };
    });
  }

  return (
    <View style={styles.container}>
      <CameraPermission>
        <Camera
          style={StyleSheet.absoluteFill}
          device="back"
          orientationSource="interface"
          isActive={active}
          outputs={outputs}
          allowHapticsAndSystemSoundsPlayback
          onStarted={() => { setCameraReady(true); setCameraError(undefined); }}
          onStopped={() => setCameraReady(false)}
          onError={(error) => { setCameraReady(false); setCameraError(error.message); }}
        />
        <ViewfinderOverlay liveQuad={detector.liveQuad} guidance={detector.guidance} />
      </CameraPermission>
      <View pointerEvents="box-none" style={[styles.overlay, { paddingTop: top + Spacing.three, paddingBottom: bottom + BottomTabInset + Spacing.three }]}>
        <View pointerEvents="box-none" style={styles.topRow}>
          <VenuePill />
          <QueueBadge />
        </View>
        <View pointerEvents="box-none" style={styles.bottom}>
          <DevTimings timings={timings} />
          {message ? <RetakeBanner message={message} onRetake={clearMessage} />
            : cameraError ? <OverlayCaption>{cameraError}</OverlayCaption>
            : busy ? <OverlayCaption>Processing photo…</OverlayCaption>
            : cameraReady && <GuidanceLabel guidance={detector.guidance} />}
          <View style={styles.controls}>
            <GlassSurface isInteractive style={styles.importButton}>
              <Pressable accessibilityRole="button" accessibilityLabel="Import" disabled={busy}
                accessibilityState={{ disabled: busy }} onPress={() => { void importPhoto(); }}
                style={({ pressed }) => [styles.importContent, (pressed || busy) && styles.dimmed]}>
                <Image source="sf:photo" style={styles.importIcon} tintColor={Colors.light.overlayText} />
              </Pressable>
            </GlassSurface>
            <Pressable accessibilityRole="button" accessibilityLabel="Take photo" disabled={!canCapture}
              accessibilityState={{ disabled: !canCapture, busy }} onPress={takePhoto}
              style={({ pressed }) => [styles.shutter, !canCapture && styles.disabled, pressed && styles.dimmed]}>
              <View style={styles.shutterCore} />
            </Pressable>
            <View style={styles.balance} />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  overlay: { ...StyleSheet.absoluteFill, justifyContent: 'space-between', paddingHorizontal: Spacing.four },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.two },
  bottom: { gap: Spacing.three },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  importButton: { width: IMPORT_SIZE, height: IMPORT_SIZE, borderRadius: IMPORT_SIZE / 2, overflow: 'hidden' },
  importContent: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  importIcon: { width: 24, height: 24 },
  shutter: {
    width: SHUTTER_SIZE, height: SHUTTER_SIZE, borderRadius: SHUTTER_SIZE / 2, borderWidth: SHUTTER_RING,
    borderColor: Colors.light.overlayText, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000000', shadowOpacity: 0.35, shadowRadius: 3, shadowOffset: { width: 0, height: 0 },
  },
  shutterCore: {
    width: SHUTTER_SIZE - 2 * (SHUTTER_RING + SHUTTER_GAP), height: SHUTTER_SIZE - 2 * (SHUTTER_RING + SHUTTER_GAP),
    borderRadius: (SHUTTER_SIZE - 2 * (SHUTTER_RING + SHUTTER_GAP)) / 2, backgroundColor: Colors.light.overlayText,
  },
  balance: { width: IMPORT_SIZE },
  disabled: { opacity: 0.4 },
  dimmed: { opacity: 0.7 },
});
