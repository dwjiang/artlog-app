import * as Sentry from "@sentry/react-native";
import { Canvas, createPicture, FilterMode, MipmapMode, Picture, Skia, useImage } from "@shopify/react-native-skia";
import { useCallback, useMemo, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { reportError } from "@/lib/observability";
import { framePatches } from "@/lib/wall/frame-patches";
import { wallFrameAssets } from "@/lib/wall/wall-frame-assets";
import { wallFrameInset, WALL_FRAMES as wallFrames, type WallFrame as Frame } from "@/shared/wall/frames";

// The height comes from the artwork's proportions rather than a layout pass, so a resized frame never draws its
// texture at the previous height.
export function WallFrame({
  frame,
  children,
  width,
  height,
}: {
  frame: Frame;
  children: ReactNode;
  width: number;
  height: number;
}) {
  const finish = wallFrames.find((item) => item.value === frame)!;
  const { sculpted } = wallFrameAssets[frame];
  const inset = wallFrameInset(frame, width);
  const scale = Math.min(1, width / 166);
  return (
    <View
      style={{
        width,
        height,
        padding: inset,
        backgroundColor: sculpted ? undefined : finish.color,
        boxShadow: sculpted
          ? undefined
          : [
              { offsetX: scale, offsetY: 2 * scale, blurRadius: 2 * scale, color: "rgba(27,20,12,0.22)" },
              { offsetX: 2 * scale, offsetY: 5 * scale, blurRadius: 7 * scale, color: "rgba(27,20,12,0.18)" },
            ],
      }}
    >
      {children}
      <FrameTexture key={frame} frame={frame} width={width} height={height} inset={inset} />
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          inset,
          boxShadow: `inset 0 ${scale}px ${2 * scale}px rgba(20,15,10,0.3)`,
        }}
      />
    </View>
  );
}

function FrameTexture({ frame, width, height, inset }: { frame: Frame; width: number; height: number; inset: number }) {
  const asset = wallFrameAssets[frame];
  const scale = Math.min(1, width / 166);
  const shadowPadding = asset.sculpted ? 12 * scale : 0;
  const onError = useCallback(() => {
    reportError(new Error("Bundled frame texture could not load"), "wall.frame.load", { data: { frame } });
  }, [frame]);
  const image = useImage(asset.source, onError);
  const picture = useMemo(() => {
    if (!image || height <= 0) return null;
    return createPicture(
      (canvas) => {
        canvas.translate(shadowPadding, shadowPadding);
        if (asset.sculpted) {
          const paint = Skia.Paint();
          paint.setImageFilter(
            Skia.ImageFilter.MakeDropShadow(
              2 * scale,
              4 * scale,
              2 * scale,
              2 * scale,
              Skia.Color("rgba(27,20,12,0.3)"),
            ),
          );
          canvas.saveLayer(paint);
        }
        for (const { src, dest } of framePatches(asset.bounds, width, height, inset)) {
          canvas.drawImageRectOptions(image, src, dest, FilterMode.Linear, MipmapMode.None);
        }
        if (asset.sculpted) canvas.restore();
      },
      { x: 0, y: 0, width: width + shadowPadding * 2, height: height + shadowPadding * 2 },
    );
  }, [asset, image, width, height, inset, scale, shadowPadding]);
  return picture ? (
    <Sentry.Mask pointerEvents="none" accessible={false} style={{ position: "absolute", inset: -shadowPadding }}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Picture picture={picture} />
      </Canvas>
    </Sentry.Mask>
  ) : null;
}
