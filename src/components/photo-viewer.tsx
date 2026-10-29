import { Image, type ImageSource } from "expo-image";
import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { GlassSurface } from "@/components/glass-surface";
import { Modal } from "@/components/modal";
import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText } from "@/components/themed-text";
import { Gallery, Motion, Radius, Spacing } from "@/constants/theme";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { knownImageSize, rememberImageSize } from "@/lib/ui/image-sizes";
import {
  containSize,
  dismissProgress,
  doubleTapZoom,
  panLimits,
  PINCH_CLOSE_SCALE,
  pinchOffset,
  pinchScale,
  rubberBand,
  settledZoom,
  shouldDismiss,
  type Point,
} from "@/lib/ui/photo-zoom";

const EASE_IN_OUT = Easing.bezier(...Motion.easeInOut);
const EASE_OUT = Easing.bezier(...Motion.easeOut);
const ZOOM = { duration: 300, easing: EASE_IN_OUT, reduceMotion: ReduceMotion.System } as const;
const SETTLE = { reduceMotion: ReduceMotion.System } as const;
// The picture shrinks a little as a dismissing drag pulls it away, as in Photos.
const DISMISS_SHRINK = 0.2;

export type PhotoViewerProps = {
  visible: boolean;
  uri: string;
  label: string;
  onClose: () => void;
  /** Buttons beside Close, such as one that opens the photo's details. */
  actions?: ReactNode;
};

/**
 * A photo full screen, as in Photos: pinch or double-tap to zoom, drag a zoomed photo around, and drag the fitted photo
 * away (or pinch it closed) to close.
 */
export function PhotoViewer({ visible, ...props }: PhotoViewerProps) {
  // Every opening starts fitted; the content stays mounted while the modal fades out.
  const [opening, setOpening] = useState({ visible, count: 0 });
  if (opening.visible !== visible) setOpening({ visible, count: opening.count + (visible ? 1 : 0) });
  // The page stays in the window under this transparent modal, so the app's safe-area insets still apply here.
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={props.onClose}>
      <GestureHandlerRootView style={styles.root}>
        <ViewerContent key={`${opening.count}:${props.uri}`} {...props} />
      </GestureHandlerRootView>
    </Modal>
  );
}

function ViewerContent({ uri, label, onClose, actions }: Omit<PhotoViewerProps, "visible">) {
  const reduced = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const { top, left, right } = useSafeAreaInsets();
  const [natural, setNatural] = useState(() => knownImageSize(uri));
  const [failed, setFailed] = useState(false);
  const fitted = containSize(natural, { width, height });
  // The gesture worklets read the screen and the fitted picture from here.
  const layout = useSharedValue({ frame: { width, height }, fitted });
  useEffect(() => {
    layout.set({ frame: { width, height }, fitted: { width: fitted.width, height: fitted.height } });
  }, [layout, width, height, fitted.width, fitted.height]);
  const scale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const pinchStart = useSharedValue({ scale: 1, offset: { x: 0, y: 0 }, focal: { x: 0, y: 0 } });
  // A drag that a pinch joined stops moving the picture until its finger lifts; the pinch owns the picture by then.
  const panStart = useSharedValue({ x: 0, y: 0, zoomed: false, pinched: false });

  const close = () => onClose();
  const zoomTo = (target: { scale: number; offset: Point }) => {
    "worklet";
    scale.set(withTiming(target.scale, ZOOM));
    x.set(withTiming(target.offset.x, ZOOM));
    y.set(withTiming(target.offset.y, ZOOM));
  };
  const fromCenter = (pointX: number, pointY: number): Point => {
    "worklet";
    const { frame } = layout.get();
    return { x: pointX - frame.width / 2, y: pointY - frame.height / 2 };
  };

  const pinch = Gesture.Pinch()
    .onStart((event) => {
      cancelAnimation(scale);
      cancelAnimation(x);
      cancelAnimation(y);
      panStart.set({ ...panStart.get(), pinched: true });
      pinchStart.set({
        scale: scale.get(),
        offset: { x: x.get(), y: y.get() },
        focal: fromCenter(event.focalX, event.focalY),
      });
    })
    .onUpdate((event) => {
      const start = pinchStart.get();
      const next = pinchScale(start.scale, event.scale);
      const offset = pinchOffset(start, next, fromCenter(event.focalX, event.focalY));
      scale.set(next);
      x.set(offset.x);
      y.set(offset.y);
    })
    .onEnd(() => {
      if (scale.get() < PINCH_CLOSE_SCALE) {
        scheduleOnRN(close);
        return;
      }
      const { frame, fitted: shown } = layout.get();
      const settled = settledZoom(scale.get(), { x: x.get(), y: y.get() }, shown, frame);
      scale.set(withSpring(settled.scale, SETTLE));
      x.set(withSpring(settled.offset.x, SETTLE));
      y.set(withSpring(settled.offset.y, SETTLE));
    });

  // Two fingers belong to the pinch, which also moves the picture with them.
  const pan = Gesture.Pan()
    .maxPointers(1)
    .onStart(() => {
      cancelAnimation(x);
      cancelAnimation(y);
      cancelAnimation(dragX);
      cancelAnimation(dragY);
      panStart.set({ x: x.get(), y: y.get(), zoomed: scale.get() > 1.01, pinched: false });
    })
    .onUpdate((event) => {
      const start = panStart.get();
      if (start.pinched) return;
      if (start.zoomed) {
        const { frame, fitted: shown } = layout.get();
        const limits = panLimits(shown, frame, scale.get());
        x.set(rubberBand(start.x + event.translationX, limits.x));
        y.set(rubberBand(start.y + event.translationY, limits.y));
      } else {
        dragX.set(event.translationX);
        dragY.set(event.translationY);
      }
    })
    .onEnd((event) => {
      const { frame, fitted: shown } = layout.get();
      const start = panStart.get();
      if (start.pinched) {
        dragX.set(withSpring(0, SETTLE));
        dragY.set(withSpring(0, SETTLE));
        return;
      }
      if (start.zoomed) {
        const limits = panLimits(shown, frame, scale.get());
        x.set(
          withDecay({ velocity: event.velocityX, clamp: [-limits.x, limits.x], rubberBandEffect: true, ...SETTLE }),
        );
        y.set(
          withDecay({ velocity: event.velocityY, clamp: [-limits.y, limits.y], rubberBandEffect: true, ...SETTLE }),
        );
        return;
      }
      if (shouldDismiss(event.translationY, event.velocityY, frame.height)) {
        if (reduced) {
          scheduleOnRN(close);
          return;
        }
        const direction = Math.sign(event.translationY || event.velocityY) || 1;
        dragY.set(
          withTiming(direction * frame.height, { duration: Motion.exit, easing: EASE_OUT }, (finished) => {
            if (finished) scheduleOnRN(close);
          }),
        );
        return;
      }
      dragX.set(withSpring(0, { velocity: event.velocityX, ...SETTLE }));
      dragY.set(withSpring(0, { velocity: event.velocityY, ...SETTLE }));
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((event, success) => {
      if (!success) return;
      const { frame, fitted: shown } = layout.get();
      zoomTo(doubleTapZoom(scale.get(), fromCenter(event.x, event.y), shown, frame));
    });

  const fade = useAnimatedStyle(() => ({ opacity: 1 - dismissProgress(dragY.get(), layout.get().frame.height) }));
  const picture = useAnimatedStyle(() => {
    const shrink = 1 - DISMISS_SHRINK * dismissProgress(dragY.get(), layout.get().frame.height);
    return {
      transform: [
        { translateX: x.get() + dragX.get() },
        { translateY: y.get() + dragY.get() },
        { scale: scale.get() * shrink },
      ],
    };
  });

  return (
    <View style={styles.root} onAccessibilityEscape={onClose}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, fade]} />
      <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
        <View
          collapsable={false}
          style={StyleSheet.absoluteFill}
          accessible
          accessibilityRole="image"
          accessibilityLabel={label}
          accessibilityHint="Pinch or double-tap to zoom. Drag down to close."
          accessibilityActions={[
            { name: "zoomIn", label: "Zoom in" },
            { name: "zoomOut", label: "Zoom out" },
          ]}
          onAccessibilityAction={({ nativeEvent }) =>
            zoomTo(
              doubleTapZoom(nativeEvent.actionName === "zoomIn" ? 1 : 2, { x: 0, y: 0 }, fitted, { width, height }),
            )
          }
        >
          <Animated.View style={[StyleSheet.absoluteFill, picture]}>
            {failed ? (
              <View style={styles.unavailable}>
                <Image source="sf:photo" tintColor={Gallery.muted} accessible={false} style={styles.unavailableIcon} />
                <ThemedText themeColor="textSecondary">Photo unavailable</ThemedText>
              </View>
            ) : (
              <Image
                source={uri}
                cachePolicy={uri.startsWith("file:") ? "memory" : "disk"}
                contentFit="contain"
                // Zooming scales the drawn picture, so it keeps its full resolution instead of the screen's.
                allowDownscaling={false}
                accessible={false}
                style={StyleSheet.absoluteFill}
                onLoad={({ source }) => {
                  rememberImageSize(uri, source);
                  if (source.width > 0 && source.height > 0) setNatural({ width: source.width, height: source.height });
                }}
                onError={() => setFailed(true)}
              />
            )}
          </Animated.View>
        </View>
      </GestureDetector>
      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.bar,
          { paddingTop: top + Spacing.two, paddingLeft: left + Spacing.content, paddingRight: right + Spacing.content },
          fade,
        ]}
      >
        <PhotoViewerButton icon="xmark" label="Close" onPress={onClose} />
        {actions && <View style={styles.actions}>{actions}</View>}
      </Animated.View>
    </View>
  );
}

/** A round control over the full-screen photo. */
export function PhotoViewerButton({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <MotionPressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      <GlassSurface tone="light" style={styles.button}>
        <Image
          source={`sf:${icon}` as ImageSource}
          tintColor={Gallery.ink}
          accessible={false}
          style={styles.buttonIcon}
        />
      </GlassSurface>
    </MotionPressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { backgroundColor: Gallery.paper },
  bar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  actions: { flexDirection: "row", gap: Spacing.two },
  button: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonIcon: { width: 18, height: 18 },
  unavailable: { flex: 1, alignItems: "center", justifyContent: "center", gap: Spacing.two },
  unavailableIcon: { width: 32, height: 32 },
});
