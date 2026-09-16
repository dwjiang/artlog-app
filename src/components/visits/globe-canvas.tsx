import { Canvas, Circle, Fill, Group, ImageShader, matchFont, RoundedRect, Shader, Skia, Text as CanvasText, useImage } from '@shopify/react-native-skia';
import { useEffect, useImperativeHandle, useState, type Ref } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { globeCamera, globeClusters, globeGeometry, hitGlobePin, type GlobeCamera, type GlobeCluster, type GlobePin } from '@/lib/journal/globe-geometry';
import { globeShader } from './globe-shader';

const shader = Skia.RuntimeEffect.Make(globeShader);
const font = matchFont({ fontFamily: 'Helvetica Neue', fontSize: 10, fontWeight: '500' });
export type GlobeCanvasHandle = { reset: () => void; focus: (pin: GlobePin) => void; zoom: (factor: number) => void };

export function GlobeCanvas({ pins, selectedId, initialPin, height, onSelect, initialCamera, onCameraChange, onCluster, ref }: {
  pins: GlobePin[]; selectedId: string; initialPin: GlobePin; height: number;
  initialCamera?: GlobeCamera; onCameraChange?: (camera: GlobeCamera) => void; onCluster?: (ids: string[]) => void;
  onSelect: (id: string) => void; ref?: Ref<GlobeCanvasHandle>;
}) {
  const [width, setWidth] = useState(0);
  // Rasterized from the GSHHG coastline polygons supplied in the design mock.
  const image = useImage(require('../../../assets/images/visit-globe-land.png'));
  const camera = useSharedValue(initialCamera ?? globeCamera(initialPin.latitude, initialPin.longitude));
  useEffect(() => { if (initialCamera) camera.set(initialCamera); }, [camera, initialCamera]);
  function setCamera(value: GlobeCamera) { camera.set(value); onCameraChange?.(value); }
  const start = useSharedValue(globeCamera(initialPin.latitude, initialPin.longitude));
  const clusters = useDerivedValue(() => globeClusters(pins, camera.get(), width, height));
  const uniforms = useDerivedValue(() => {
    const current = camera.get(), geometry = globeGeometry(width, height, current.zoom);
    return { center: [geometry.cx, geometry.cy], radius: geometry.radius, yaw: current.yaw * Math.PI / 180, pitch: current.pitch * Math.PI / 180 };
  });
  useImperativeHandle(ref, () => ({
    reset: () => setCamera(globeCamera(initialPin.latitude, initialPin.longitude)),
    focus: (pin) => setCamera(globeCamera(pin.latitude, pin.longitude)),
    zoom: (factor) => setCamera({ ...camera.get(), zoom: Math.max(0.75, Math.min(2.25, camera.get().zoom * factor)) }),
  }));
  const pan = Gesture.Pan().maxPointers(1).minDistance(4)
    .onStart(() => { start.set(camera.get()); })
    .onUpdate((event) => {
      const origin = start.get();
      camera.set({ ...camera.get(), yaw: (origin.yaw + event.translationX * 0.34 / origin.zoom) % 360,
        pitch: Math.max(-75, Math.min(75, origin.pitch + event.translationY * 0.28 / origin.zoom)) });
    }).onFinalize(() => { if (onCameraChange) scheduleOnRN(onCameraChange, camera.get()); });
  const pinch = Gesture.Pinch().onStart(() => { start.set(camera.get()); }).onUpdate((event) => {
    camera.set({ ...camera.get(), zoom: Math.max(0.75, Math.min(2.25, start.get().zoom * event.scale)) });
  }).onFinalize(() => { if (onCameraChange) scheduleOnRN(onCameraChange, camera.get()); });
  const tap = Gesture.Tap().onEnd((event, success) => {
    if (!success) return;
    const id = hitGlobePin(clusters.get(), event.x, event.y);
    if (!id) return;
    const cluster = clusters.get().find((group) => group.ids.includes(id));
    if (cluster && cluster.ids.length > 1) {
      if (camera.get().zoom >= 2.2) { if (onCluster) scheduleOnRN(onCluster, cluster.ids); }
      else {
        const pin = pins.find((pin) => pin.id === id);
        if (pin) camera.set({ ...globeCamera(pin.latitude, pin.longitude), zoom: Math.min(2.25, camera.get().zoom * 1.6) });
        if (onCameraChange) scheduleOnRN(onCameraChange, camera.get());
      }
    } else scheduleOnRN(onSelect, id);
  });
  const doubleTap = Gesture.Tap().numberOfTaps(2).onEnd((_event, success) => {
    if (success) { camera.set((current) => ({ ...current, zoom: Math.min(2.25, current.zoom * 1.25) })); if (onCameraChange) scheduleOnRN(onCameraChange, camera.get()); }
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
    <Circle cx={0} cy={0} r={19} color="#F7F7EF77" opacity={selected} />
    <Circle cx={0} cy={0} r={radius} color="#384932" />
    <Circle cx={0} cy={0} r={radius} color="#F2F3E8" style="stroke" strokeWidth={2} />
    <CanvasText x={countX} y={3.5} text={countText} font={font} color="#FCFBF3" />
    <Group opacity={labelOpacity}>
      <RoundedRect x={labelX} y={13} width={labelWidth} height={17} r={4} color="#F4F4EDD9" />
      <CanvasText x={textX} y={25} text={label} font={font} color="#43513C" />
    </Group>
  </Group>;
}
const styles = StyleSheet.create({
  shadow: { height: 10, borderRadius: 100, backgroundColor: '#5560480C', boxShadow: '0 0 15px 7px #55604814' },
});
