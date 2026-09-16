import { Button, Host, Row } from '@expo/ui';
import { Image } from 'expo-image';
import { useNavigation, type NativeStackNavigationProp } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import type { ParamListBase } from 'expo-router/react-navigation';
import { useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, StyleSheet, View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, usePhotoOutput } from 'react-native-vision-camera';

import { CameraPermission } from './camera-permission';
import { CaptureReveal } from './capture-reveal';
import { DevTimings } from './dev-timings';
import { OverlayCaption } from './overlay-caption';
import { QueueBadge } from './queue-badge';
import { VenuePill } from './venue-pill';
import { CaptureContextButton } from './capture-context-button';
import { CaptureDraftBanner } from './capture-draft-banner';
import { BottomTabInset, Gallery, Spacing } from '@/constants/theme';
import { useCapture } from '@/lib/capture/use-capture';

const IMPORT_SIZE = 56;

export function ScanScreen() {
  const isFocused = useIsFocused();
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const [appState, setAppState] = useState(AppState.currentState);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string>();
  const [controls, setControls] = useState({ top: 0, bottom: 0 });
  const { top, bottom } = useSafeAreaInsets();
  const revealInsets = useMemo(() => ({
    top: top + Spacing.three + controls.top + Spacing.four,
    bottom: bottom + BottomTabInset + Spacing.three + controls.bottom + Spacing.four,
  }), [top, bottom, controls]);
  const active = isFocused && appState === 'active';
  const photoOutput = usePhotoOutput({ containerFormat: 'jpeg', quality: 1 });
  const capture = useCapture({ active, focused: isFocused });
  const { phase, occupied, source, message } = capture.state;
  const searching = !occupied && (phase === 'searching' || (phase === 'retry' && source !== 'library'));
  const outputs = useMemo(() => [photoOutput], [photoOutput]);
  const busy = occupied || !['searching', 'retry'].includes(phase);
  const failedImport = phase === 'retry' && source === 'library';
  const { endResultTransition } = capture;

  useEffect(() => navigation.addListener('transitionEnd', ({ data }) => {
    if (data.closing) endResultTransition();
  }), [navigation, endResultTransition]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  return (
    <View style={styles.container}>
      <View style={[StyleSheet.absoluteFill, { top: top + 82, bottom: bottom + BottomTabInset + 205, left: 20, right: 20, borderRadius: 24, overflow: 'hidden', backgroundColor: '#DDE3D8' }]}><CameraPermission>
        <Camera style={StyleSheet.absoluteFill}
          device="back"
          orientationSource="interface"
          resizeMode="cover"
          isActive={active && (searching || (phase === 'capturing' && source === 'camera'))}
          outputs={outputs}
          allowHapticsAndSystemSoundsPlayback
          onStarted={() => { setCameraReady(true); setCameraError(undefined); }}
          onStopped={() => setCameraReady(false)}
          onError={() => { setCameraReady(false); setCameraError('Could not start the camera. You can import a photo.'); }}
        />
      </CameraPermission></View>
      {capture.presentation && <CaptureReveal key={capture.presentation.attempt.id} presentation={capture.presentation} insets={revealInsets} onComplete={() => capture.completeReveal(capture.presentation!.attempt)} />}
      <View pointerEvents="box-none" style={[styles.overlay, { paddingTop: top + Spacing.three, paddingBottom: bottom + BottomTabInset + Spacing.three }]}>
        <View pointerEvents="box-none" style={styles.topRow} onLayout={({ nativeEvent: { layout } }) => setControls((value) => ({ ...value, top: layout.height }))}>
          <VenuePill />
          <QueueBadge />
        </View>
        <View pointerEvents="box-none" style={styles.bottom} onLayout={({ nativeEvent: { layout } }) => setControls((value) => ({ ...value, bottom: layout.height }))}>
          {!busy && <CaptureDraftBanner />}
          <CaptureContextButton />
          <DevTimings timings={busy ? undefined : capture.timings} />
          {message ? <View accessible accessibilityRole="alert"><OverlayCaption hint={failedImport ? undefined : 'Reframe the artwork and tap the shutter.'}>{message}</OverlayCaption></View>
            : busy ? <OverlayCaption>{phase === 'revealing' || phase === 'result' ? 'Recognizing artwork…' : 'Preparing painting…'}</OverlayCaption>
            : cameraError ? <OverlayCaption>{cameraError}</OverlayCaption>
            : cameraReady && <OverlayCaption>Frame an artwork and tap the shutter.</OverlayCaption>}
          {failedImport ? <Host matchContents colorScheme="light">
            <Row spacing={Spacing.three}>
              <Button label="Choose another photo" onPress={() => { void capture.importPhoto(); }} />
              <Button label="Use camera" onPress={capture.useCamera} />
            </Row>
          </Host> : <View style={styles.controls}>
            <View style={styles.importButton}>
              <Pressable accessibilityRole="button" accessibilityLabel="Import" disabled={busy || !active}
                accessibilityState={{ disabled: busy || !active }} onPress={() => { void capture.importPhoto(); }}
                style={({ pressed }) => [styles.importContent, (pressed || busy) && styles.dimmed]}>
                <Image source="sf:photo" style={styles.importIcon} tintColor={Gallery.accent} />
              </Pressable>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Scan artwork" disabled={busy || !active || !cameraReady}
              onPress={() => { void capture.captureManually(() => photoOutput.capturePhotoToFile({}, {})); }}
              style={[styles.shutter, (busy || !cameraReady) && styles.dimmed]}><View style={styles.shutterInner} /></Pressable>
            <Text style={{ color: Gallery.muted, fontSize: 11, width: 56, textAlign: 'center' }}>Scan artwork</Text>
          </View>}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Gallery.paper },
  overlay: { ...StyleSheet.absoluteFill, justifyContent: 'space-between', paddingHorizontal: Spacing.four },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.two },
  bottom: { gap: Spacing.three },
  controls: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  shutter: { width: 72, height: 72, borderRadius: 36, borderWidth: 2, borderColor: Gallery.accent, padding: 5 },
  shutterInner: { flex: 1, borderRadius: 32, backgroundColor: Gallery.accent },
  importButton: { backgroundColor: Gallery.fill, width: IMPORT_SIZE, height: IMPORT_SIZE, borderRadius: IMPORT_SIZE / 2, overflow: 'hidden' },
  importContent: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  importIcon: { width: 24, height: 24 },
  dimmed: { opacity: 0.7 },
});
