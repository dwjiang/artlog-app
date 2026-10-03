import { Image } from "expo-image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import { Colors } from "@/constants/theme";
import { revealGeometry } from "@/lib/capture/reveal-geometry";
import type { CapturePresentation } from "@/lib/capture/use-capture";

import { HIGHLIGHT_MS, PaintingReveal, SHINE_DELAY_MS, SHINE_MS } from "./painting-reveal";

export const REVEAL_TIMEOUT_MS = HIGHLIGHT_MS + SHINE_DELAY_MS + SHINE_MS + 2000;

export function CaptureReveal({
  presentation,
  insets,
  onComplete,
}: {
  presentation: CapturePresentation;
  insets?: { top: number; bottom: number };
  onComplete: () => void;
}) {
  const { photo, photoUri, source, painting, crop, turns = 0 } = presentation;
  const fit = source === "camera" ? "cover" : "contain";
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const [displayed, setDisplayed] = useState(false);
  const completed = useRef(false);
  const callback = useRef(onComplete);
  useEffect(() => {
    callback.current = onComplete;
  }, [onComplete]);
  const finish = useCallback(() => {
    if (completed.current) return;
    completed.current = true;
    callback.current();
  }, []);
  const geometry = useMemo(
    () => (painting ? revealGeometry(painting, layout, fit, insets, turns) : null),
    [painting, layout, fit, insets, turns],
  );

  useEffect(() => {
    if (!painting) return;
    // A missing layout or native image event cannot strand a valid scan on this screen.
    const timer = setTimeout(finish, REVEAL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [painting, finish]);

  useEffect(() => {
    if (painting && layout.width && layout.height && !geometry) finish();
  }, [painting, layout.width, layout.height, geometry, finish]);

  return (
    <View
      pointerEvents="none"
      style={styles.container}
      onLayout={({ nativeEvent: { layout: next } }) => setLayout({ width: next.width, height: next.height })}
    >
      <PaintingReveal
        geometry={geometry}
        crop={crop}
        playing={displayed}
        background={(blurRadius) => (
          <Image
            cachePolicy="memory"
            source={photo ?? photoUri}
            contentFit={fit}
            blurRadius={blurRadius}
            style={turnedBack(layout, turns)}
            onError={finish}
            accessibilityLabel="Captured painting"
          />
        )}
        onCropDisplay={() => setDisplayed(true)}
        onError={finish}
        onFinish={finish}
      />
    </View>
  );
}

/** Fills the view with a photo taken with the phone turned, turned back the way the preview showed it. */
function turnedBack(view: { width: number; height: number }, turns: number) {
  if (turns % 4 === 0) return StyleSheet.absoluteFill;
  const width = turns % 2 ? view.height : view.width;
  const height = turns % 2 ? view.width : view.height;
  return {
    position: "absolute",
    left: (view.width - width) / 2,
    top: (view.height - height) / 2,
    width,
    height,
    transform: [{ rotate: `${-90 * turns}deg` }],
  } as const;
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: Colors.light.background,
    overflow: "hidden",
  },
});
