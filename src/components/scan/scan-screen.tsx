import { introArtworks } from '../guest/artwork-preview';
import { GalleryButton } from '../collection/gallery-button';
import { WallSheet } from '../collection/wall-sheet';
import { ThemedText } from '../themed-text';
import { LoadingRing } from '@/components/loading-ring';
import { CaptureVisitPill } from './capture-visit-pill';
import { Button, Host, Row } from '@expo/ui';
import { Image } from 'expo-image';
import { useLocalSearchParams, useNavigation, type NativeStackNavigationProp } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import type { ParamListBase } from 'expo-router/react-navigation';
import { useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, usePhotoOutput } from 'react-native-vision-camera';

import { CameraPermission } from './camera-permission';
import { CaptureReveal } from './capture-reveal';
import { DevTimings } from './dev-timings';
import { OverlayCaption } from './overlay-caption';
import { QueueBadge } from './queue-badge';
import { VenuePill } from './venue-pill';
import { GlassSurface } from '@/components/glass-surface';
import { BottomTabInset, Colors, Gallery, Spacing } from '@/constants/theme';
import { useCapture } from '@/lib/capture/use-capture';
import { useRectDetector } from '@/lib/capture/use-rect-detector';

const IMPORT_SIZE = 56;
const SHUTTER_SIZE = 72;

export function ScanScreen() {
  const isFocused = useIsFocused();
  const { visitId } = useLocalSearchParams<{ visitId?: string }>();
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const [appState, setAppState] = useState(AppState.currentState);
  const [help, setHelp] = useState<'open' | 'import'>();
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string>();
  const [preview, setPreview] = useState({ width: 0, height: 0 });
  const [controls, setControls] = useState({ top: 0, bottom: 0 });
  const { top, bottom } = useSafeAreaInsets();
  const revealInsets = useMemo(() => ({
    top: top + Spacing.three + controls.top + Spacing.four,
    bottom: bottom + BottomTabInset + Spacing.three + controls.bottom + Spacing.four,
  }), [top, bottom, controls]);
  const active = isFocused && appState === 'active';
  const photoOutput = usePhotoOutput({ containerFormat: 'jpeg', quality: 1 });
  const capture = useCapture({ active, focused: isFocused, visitLocalId: visitId, onVisitUnavailable: () => navigation.setParams({ visitId: undefined }) });
  const { phase, occupied, source, message, rearm } = capture.state;
  // A visit chosen in link-artwork covers one capture: it ends at the result or when another tab is selected.
  // Sheets and the visit's own screen sit above the tab and keep it.
  useEffect(() => { if (visitId && phase === 'result') navigation.setParams({ visitId: undefined }); }, [navigation, phase, visitId]);
  useEffect(() => {
    if (!visitId) return;
    return navigation.getParent()?.addListener('state', ({ data }) => {
      if (data.state.routes[data.state.index]?.name !== '(scan)') navigation.setParams({ visitId: undefined });
    });
  }, [navigation, visitId]);
  const searching = !occupied && (phase === 'searching' || (phase === 'retry' && source !== 'library'));
  const detecting = active && !help && cameraReady && searching;
  const frameOutput = useRectDetector(detecting, (detection) => {
    const attempt = capture.controller.observe(detection, preview, performance.now());
    if (attempt) void capture.captureAutomatically(attempt, () => photoOutput.capturePhotoToFile({}, {}));
  });
  const outputs = useMemo(() => [photoOutput, frameOutput], [photoOutput, frameOutput]);
  const busy = occupied || !['searching', 'retry'].includes(phase);
  const cameraActive = active && !help && (searching || (phase === 'capturing' && source === 'camera'));
  const failedImport = phase === 'retry' && source === 'library';
  const retryHint = failedImport ? undefined : rearm === 'shutter' ? 'Reframe the artwork and tap the shutter.' : 'Move the camera to reframe, then hold steady.';
  const shutterDisabled = busy || !active || !cameraReady;
  const { endResultTransition } = capture;

  useEffect(() => navigation.addListener('transitionEnd', ({ data }) => {
    if (data.closing) endResultTransition();
  }), [navigation, endResultTransition]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  return (
    <View style={styles.container} onLayout={({ nativeEvent: { layout } }) => setPreview({ width: layout.width, height: layout.height })}>
      <CameraPermission onImport={() => { void capture.importPhoto(); }} notice={message} loading={cameraActive && !cameraReady && !cameraError}>
        <Camera
          style={StyleSheet.absoluteFill}
          device="back"
          orientationSource="interface"
          resizeMode="cover"
          isActive={cameraActive}
          outputs={outputs}
          allowHapticsAndSystemSoundsPlayback
          onStarted={() => { setCameraReady(true); setCameraError(undefined); }}
          onStopped={() => setCameraReady(false)}
          onError={() => { setCameraReady(false); setCameraError('Could not start the camera. You can import a photo.'); }}
        />
      <View pointerEvents="box-none" style={[styles.overlay, { paddingBottom: bottom + BottomTabInset + Spacing.three }]}>
        <View pointerEvents="box-none" style={styles.bottom} onLayout={({ nativeEvent: { layout } }) => setControls((value) => ({ ...value, bottom: layout.height }))}>
          <DevTimings timings={busy ? undefined : capture.timings} />
          {message ? <View accessible accessibilityRole="alert"><OverlayCaption hint={retryHint}>{message}</OverlayCaption></View>
            : busy ? <OverlayCaption><LoadingRing accessibilityLabel={phase === 'revealing' || phase === 'result' ? 'Recognizing artwork…' : 'Preparing painting…'} color={Colors.light.overlayText} /></OverlayCaption>
            : cameraReady && <OverlayCaption>Point at an artwork. Hold steady to scan.</OverlayCaption>}
          {failedImport ? <Host matchContents colorScheme="light">
            <Row spacing={Spacing.three}>
              <Button label="Choose another photo" onPress={() => { void capture.importPhoto(); }} />
              <Button label="Use camera" onPress={capture.useCamera} />
            </Row>
          </Host> : <View style={styles.controls}>
            <GlassSurface isInteractive style={styles.importButton}>
              <Pressable accessibilityRole="button" accessibilityLabel="Import" disabled={busy || !active}
                accessibilityState={{ disabled: busy || !active }} onPress={() => { void capture.importPhoto(); }}
                style={({ pressed }) => [styles.importContent, (pressed || busy) && styles.dimmed]}>
                <Image source="sf:photo" style={styles.importIcon} tintColor={Colors.light.overlayText} />
              </Pressable>
            </GlassSurface>
            <Pressable accessibilityRole="button" accessibilityLabel="Scan artwork" accessibilityHint="Scans now instead of waiting for automatic detection"
              disabled={shutterDisabled} accessibilityState={{ disabled: shutterDisabled, busy }}
              onPress={() => { void capture.captureManually(() => photoOutput.capturePhotoToFile({}, {})); }}
              style={({ pressed }) => [styles.shutter, (pressed || shutterDisabled) && styles.dimmed]}><View style={styles.shutterInner} /></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Camera tips" onPress={() => setHelp('open')} style={{ width: 56, height: 56, alignItems: 'center', justifyContent: 'center' }}><Image source="sf:info.circle" tintColor={Colors.light.overlayText} style={{ width: 26, height: 26 }} /></Pressable>
          </View>}
        </View>
      </View>
      </CameraPermission>
      {/* The venue and queue entry points have no other home, so they stay above the permission invitation as well. */}
      <View pointerEvents="box-none" style={[styles.topLayer, { paddingTop: top + Spacing.three }]}>
        <View pointerEvents="box-none" style={styles.top} onLayout={({ nativeEvent: { layout } }) => setControls((value) => ({ ...value, top: layout.height }))}>
          <View pointerEvents="box-none" style={styles.topRow}>
            {visitId ? <CaptureVisitPill visitId={visitId} /> : <VenuePill />}
            <QueueBadge />
          </View>
          {cameraError && !message && !busy && <View accessible accessibilityRole="alert">
            <OverlayCaption>{cameraError}</OverlayCaption>
          </View>}
        </View>
      </View>
      {capture.presentation && <CaptureReveal key={capture.presentation.attempt.id} presentation={capture.presentation} insets={revealInsets} onComplete={() => capture.completeReveal(capture.presentation!.attempt)} />}
      {help && <WallSheet title="Camera tips" tall presented={help === 'open'} onDismiss={() => setHelp((current) => current === 'import' ? current : undefined)}
        onDismissed={() => { setHelp(undefined); if (help === 'import') void capture.importPhoto(); }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 32, gap: 14 }}>
        <Image source={introArtworks.stars.source} contentFit="contain" style={{ width: '100%', height: 180, backgroundColor: Gallery.fill }} accessibilityLabel="Example of an artwork framed straight on" />
        <ThemedText variant="display">Get the whole picture.</ThemedText>
        <ThemedText>Fit the whole artwork in the frame, face it straight on, and hold steady.</ThemedText>
        <ThemedText themeColor="textSecondary">Avoid glare by moving a little to the side. If the artwork is hard to identify, try its museum label.</ThemedText>
        <GalleryButton label="Ready to scan" variant="filled" fullWidth onPress={() => setHelp(undefined)} />
        <GalleryButton label="Import a photo instead" fullWidth onPress={() => setHelp('import')} />
      </ScrollView></WallSheet>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Gallery.paper },
  overlay: { ...StyleSheet.absoluteFill, justifyContent: 'flex-end', paddingHorizontal: Spacing.content },
  topLayer: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: Spacing.content },
  top: { gap: Spacing.three },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.two },
  bottom: { gap: Spacing.three },
  controls: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  shutter: { width: SHUTTER_SIZE, height: SHUTTER_SIZE, borderRadius: SHUTTER_SIZE / 2, borderWidth: 3, borderColor: Colors.light.overlayText, padding: 4 },
  shutterInner: { flex: 1, borderRadius: SHUTTER_SIZE / 2, backgroundColor: Colors.light.overlayText },
  importButton: { width: IMPORT_SIZE, height: IMPORT_SIZE, borderRadius: IMPORT_SIZE / 2, overflow: 'hidden' },
  importContent: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  importIcon: { width: 24, height: 24 },
  dimmed: { opacity: 0.7 },
});
