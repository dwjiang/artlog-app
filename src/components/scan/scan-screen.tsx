import { Button, Host } from '@expo/ui';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useIsFocused } from 'expo-router/react-navigation';
import { useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, usePhotoOutput } from 'react-native-vision-camera';

import { CameraPermission } from './camera-permission';
import { GuidanceLabel, ViewfinderOverlay } from './viewfinder-overlay';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Colors, Spacing } from '@/constants/theme';
import type { CaptureTimings } from '@/lib/capture/stages';
import { useCapture } from '@/lib/capture/use-capture';
import { useRectDetector } from '@/lib/capture/use-rect-detector';
import { resolveVenueForScan } from '@/lib/venue/use-venue';

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
        <View style={styles.status}>
          {(message || cameraError) && (
            <View style={styles.notice}>
              <ThemedText selectable>{message ?? cameraError}</ThemedText>
              {message && (
                <Host matchContents colorScheme="light">
                  <Button label="Retake" onPress={clearMessage} />
                </Host>
              )}
            </View>
          )}
          {busy && <View style={styles.notice}><ThemedText>Processing photo…</ThemedText></View>}
          {!busy && !message && cameraReady && <GuidanceLabel guidance={detector.guidance} />}
          {__DEV__ && timings && (
            <View style={styles.notice}><ThemedText type="code">{formatCaptureTimings(timings)}</ThemedText></View>
          )}
        </View>
        <View style={styles.controls}>
          <Pressable accessibilityRole="button" accessibilityLabel="Import" disabled={busy}
            accessibilityState={{ disabled: busy }} onPress={() => { void importPhoto(); }}
            style={[styles.importButton, busy && styles.disabled]}>
            <Image source="sf:photo" style={styles.importIcon} tintColor={Colors.light.text} />
            <ThemedText>Import</ThemedText>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Take photo" disabled={!canCapture}
            accessibilityState={{ disabled: !canCapture, busy }} onPress={takePhoto}
            style={[styles.shutter, !canCapture && styles.disabled]} />
          <View style={styles.balance} />
        </View>
      </View>
    </View>
  );
}

function formatCaptureTimings({ total, ...stages }: CaptureTimings): string {
  const parts = Object.entries(stages).map(([stage, ms]) => `${stage} ${Math.round(ms)}`);
  return [`Capture ${Math.round(total)} ms`, ...parts].join(' · ');
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  overlay: { ...StyleSheet.absoluteFill, justifyContent: 'space-between', paddingHorizontal: Spacing.four },
  status: { gap: Spacing.two },
  notice: { backgroundColor: Colors.light.background, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  importButton: { width: 76, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: Spacing.one, backgroundColor: Colors.light.background, borderRadius: Spacing.three },
  importIcon: { width: 24, height: 24 },
  shutter: { width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.light.background, borderWidth: 4, borderColor: Colors.light.textSecondary },
  balance: { width: 76 },
  disabled: { opacity: 0.45 },
});
