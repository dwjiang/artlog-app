import { Image } from "expo-image";
import { Text, View } from "react-native";
import type { PreparedWidgetArtwork } from "@/lib/widgets/widget-collection";
import { paintingLayout, widgetPresentation, type WidgetLayout } from "@/lib/widgets/widget-layout";
import type { WidgetSettings, WidgetSize } from "@/lib/widgets/widget-settings";

export function WidgetDrawing({ layout, scale = 1 }: { layout: WidgetLayout; scale?: number }) {
  const position = ({ x, y, width, height }: { x: number; y: number; width: number; height: number }) => ({
    position: "absolute" as const,
    left: x * scale,
    top: y * scale,
    width: width * scale,
    height: height * scale,
  });
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      style={{ width: layout.width * scale, height: layout.height * scale }}
    >
      {layout.rectangles.map((rect, i) => (
        <View key={i} style={[position(rect), { backgroundColor: rect.color }]} />
      ))}
      {layout.image && (
        <Image
          cachePolicy="memory"
          source={layout.image.uri}
          contentFit="contain"
          transition={0}
          style={position(layout.image)}
        />
      )}
      {layout.texts.map((row, i) => (
        <Text
          key={i}
          allowFontScaling={false}
          numberOfLines={1}
          style={[
            position(row),
            {
              fontFamily: row.family,
              fontSize: row.size * scale,
              lineHeight: row.height * scale,
              color: row.color,
            },
          ]}
        >
          {row.text}
        </Text>
      ))}
    </View>
  );
}

export function WidgetPreview({
  artwork,
  settings,
  size,
  width,
}: {
  artwork?: PreparedWidgetArtwork;
  settings: WidgetSettings;
  size: WidgetSize;
  width: number;
}) {
  const presentation = widgetPresentation(artwork, settings),
    layout = presentation[size];
  const scale = width / layout.width;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${size === "small" ? "Small" : "Medium"} widget preview. ${presentation.label}`}
      style={{
        width,
        height: layout.height * scale,
        borderRadius: 25 * scale,
        backgroundColor: presentation.background,
        overflow: "hidden",
      }}
    >
      <WidgetDrawing layout={layout} scale={scale} />
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 25 * scale,
          borderWidth: 1,
          borderColor: "#92968C",
        }}
      />
    </View>
  );
}

export function WidgetFrameSample({ artwork, settings }: { artwork: PreparedWidgetArtwork; settings: WidgetSettings }) {
  return (
    <WidgetDrawing
      layout={{
        width: 48,
        height: 48,
        texts: [],
        ...paintingLayout(artwork, { x: 0, y: 0, width: 48, height: 48 }, settings),
      }}
    />
  );
}
