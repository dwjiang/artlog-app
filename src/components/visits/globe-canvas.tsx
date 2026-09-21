import { Canvas, Circle, Fill, Group, ImageShader, matchFont, RoundedRect, Shader, Skia, Text as CanvasText, useImage } from '@shopify/react-native-skia';
import { useImperativeHandle, useState, type Ref } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import { globeCamera, globeClusters, globeGeometry, hitGlobePin, type GlobeCamera, type GlobeCluster, type GlobePin } from '@/lib/journal/globe-geometry';
import { Gallery } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { globeShader } from './globe-shader';
import { useGlobeCamera } from './use-globe-camera';

const shader = Skia.RuntimeEffect.Make(globeShader);
const font = matchFont({ fontFamily: 'Helvetica Neue', fontSize: 13, fontWeight: '500' });
export type GlobeCanvasHandle = { reset: () => void; focus: (pin: GlobePin) => void; zoom: (factor: number) => void; settle: () => void };

export function GlobeCanvas({ pins, selectedId, initialPin, height, onSelect, initialCamera, onCameraChange, onCluster, ref }: {
  pins: GlobePin[]; selectedId: string; initialPin: GlobePin; height: number;
  initialCamera?: GlobeCamera; onCameraChange?: (camera: GlobeCamera) => void; onCluster?: (ids: string[]) => void;
  onSelect: (id: string) => void; ref?: Ref<GlobeCanvasHandle>;
}) {
  const [width, setWidth] = useState(0);
  // Rasterized from the GSHHG coastline polygons supplied in the design mock.
  const image = useImage(require('../../../assets/images/visit-globe-land.png'));
  const { camera, pan, pinch, setCamera, settle, stop, save } = useGlobeCamera(initialCamera ?? globeCamera(initialPin.latitude, initialPin.longitude), onCameraChange);
  const clusters = useDerivedValue(() => globeClusters(pins, camera.get(), width, height));
  const uniforms = useDerivedValue(() => {
    const current = camera.get(), geometry = globeGeometry(width, height, current.zoom);
    return { center: [geometry.cx, geometry.cy], radius: geometry.radius, yaw: current.yaw * Math.PI / 180, pitch: current.pitch * Math.PI / 180 };
  });
  useImperativeHandle(ref, () => ({
    reset: () => scheduleOnUI(setCamera, globeCamera(initialPin.latitude, initialPin.longitude)),
    focus: (pin) => scheduleOnUI(setCamera, globeCamera(pin.latitude, pin.longitude)),
    zoom: (factor) => scheduleOnUI(() => {
      'worklet';
      setCamera({ ...camera.get(), zoom: Math.max(0.75, Math.min(2.25, camera.get().zoom * factor)) });
    }),
    settle,
  }));
  const tap = Gesture.Tap().onBegin(stop).onEnd((event, success) => {
    if (!success) return;
    save();
    const id = hitGlobePin(clusters.get(), event.x, event.y);
    if (!id) return;
    const cluster = clusters.get().find((group) => group.ids.includes(id));
    if (cluster && cluster.ids.length > 1) {
      if (camera.get().zoom >= 2.2) { if (onCluster) scheduleOnRN(onCluster, cluster.ids); }
      else {
        const pin = pins.find((pin) => pin.id === id);
        if (pin) setCamera({ ...globeCamera(pin.latitude, pin.longitude), zoom: Math.min(2.25, camera.get().zoom * 1.6) });
      }
    } else scheduleOnRN(onSelect, id);
  });
  const doubleTap = Gesture.Tap().numberOfTaps(2).onBegin(stop).onEnd((_event, success) => {
    if (success) setCamera({ ...camera.get(), zoom: Math.min(2.25, camera.get().zoom * 1.25) });
  });
  return <GestureHandlerRootView style={{ height }}><GestureDetector gesture={Gesture.Race(Gesture.Simultaneous(pan, pinch), Gesture.Exclusive(doubleTap, tap))}>
    <View collapsable={false} onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ height }}
      accessible accessibilityRole="image" accessibilityLabel="Interactive globe of your museum visits"
      accessibilityHint="Drag to rotate and pinch to zoom. Use Choose a visited museum to select a place without gestures.">
      <View pointerEvents="none" style={[styles.shadow, { width: width * 0.46, left: width * 0.27, top: height * 0.87 }]} />
      <Canvas style={StyleSheet.absoluteFill}>
        {image && shader && width > 0 && <>
          <Fill><Shader source={shader} uniforms={uniforms}><ImageShader image={image} fit="fill" rect={{ x: 0, y: 0, width: 2048, height: 1024 }} /></Shader></Fill>
          {pins.map((pin, index) => <GlobeMarker key={pin.id} index={index} clusters={clusters} selectedId={selectedId} width={width} />)}
        </>}
      </Canvas>
      {(!shader || !image) && <View style={{ padding: 20, gap: 8 }}><ThemedText variant="secondary">{!shader ? 'Globe rendering is unavailable. Use the museum chooser or List.' : 'Loading globe…'}</ThemedText></View>}
    </View>
  </GestureDetector></GestureHandlerRootView>;
}
function GlobeMarker({ index, clusters, selectedId, width }: { index: number; clusters: SharedValue<GlobeCluster[]>; selectedId: string; width: number }) {
  const cluster = useDerivedValue(() => clusters.get()[index]);
  const opacity = useDerivedValue(() => cluster.get() ? 1 : 0);
  const transform = useDerivedValue(() => [{ translateX: cluster.get()?.x ?? 0 }, { translateY: cluster.get()?.y ?? 0 }]);
  const count = useDerivedValue(() => cluster.get()?.ids.length ?? 0);
  const radius = useDerivedValue(() => count.get() > 1 ? 12 : 7);
  const selected = useDerivedValue(() => cluster.get()?.ids.includes(selectedId) ? 1 : 0);
  const countText = useDerivedValue(() => count.get() > 1 ? String(count.get()) : '');
  const countX = useDerivedValue(() => -font.measureText(countText.get()).width / 2);
  const label = useDerivedValue(() => count.get() === 1 ? cluster.get()?.label ?? '' : '');
  const labelWidth = useDerivedValue(() => font.measureText(label.get()).width + 10);
  const labelX = useDerivedValue(() => Math.max(5 - (cluster.get()?.x ?? 0), Math.min(width - (cluster.get()?.x ?? 0) - labelWidth.get() - 5, -labelWidth.get() / 2)));
  const textX = useDerivedValue(() => labelX.get() + 5);
  const labelOpacity = useDerivedValue(() => count.get() === 1 ? 1 : 0);
  return <Group opacity={opacity} transform={transform}>
    <Circle cx={0} cy={0} r={19} color={Gallery.highlight} opacity={selected} style="stroke" strokeWidth={3} />
    <Circle cx={0} cy={0} r={radius} color={Gallery.accent} />
    <Circle cx={0} cy={0} r={radius} color={Gallery.paper} style="stroke" strokeWidth={2} />
    <CanvasText x={countX} y={3.5} text={countText} font={font} color={Gallery.surface} />
    <Group opacity={labelOpacity}>
      <RoundedRect x={labelX} y={13} width={labelWidth} height={22} r={2} color={Gallery.paper} />
      <CanvasText x={textX} y={29} text={label} font={font} color={Gallery.ink} />
    </Group>
  </Group>;
}
const styles = StyleSheet.create({
  shadow: { height: 10, borderRadius: 100, backgroundColor: '#1717150C', boxShadow: '0 0 15px 7px #17171514' },
});
