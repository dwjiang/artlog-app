import { Image, Rectangle, Text, ZStack } from "@expo/ui/swift-ui";
import {
  accessibilityElement,
  accessibilityLabel,
  containerBackground,
  dynamicTypeSize,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  offset,
  resizable,
  widgetURL,
} from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";
import type { WidgetPresentation } from "./widget-layout";

function ArtlogWidget(props: WidgetPresentation, environment: WidgetEnvironment & { width?: number; height?: number }) {
  "widget";
  const layout = environment.widgetFamily === "systemSmall" ? props.small : props.medium;
  const scale = Math.min(
    (environment.width ?? layout.width) / layout.width,
    (environment.height ?? layout.height) / layout.height,
  );
  // Caption rows are wrapped with fixed font metrics, so Dynamic Type growth would truncate and overlap them.
  return (
    <ZStack
      modifiers={[
        frame({ maxWidth: Infinity, maxHeight: Infinity }),
        containerBackground(props.background, "widget"),
        dynamicTypeSize("large"),
        widgetURL(props.url),
        accessibilityElement("ignore"),
        accessibilityLabel(props.label),
      ]}
    >
      <ZStack
        alignment="topLeading"
        modifiers={[
          frame({
            width: layout.width * scale,
            height: layout.height * scale,
            alignment: "topLeading",
          }),
        ]}
      >
        {layout.rectangles.map((rect, index) => (
          <Rectangle
            key={index}
            modifiers={[
              foregroundStyle(rect.color),
              frame({ width: rect.width * scale, height: rect.height * scale }),
              offset({ x: rect.x * scale, y: rect.y * scale }),
            ]}
          />
        ))}
        {layout.image && (
          <Image
            uiImage={layout.image.uri}
            modifiers={[
              resizable(),
              frame({
                width: layout.image.width * scale,
                height: layout.image.height * scale,
              }),
              offset({ x: layout.image.x * scale, y: layout.image.y * scale }),
            ]}
          />
        )}
        {/* Expo Text applies modifiers internally too; position its container to avoid applying offsets twice. */}
        {layout.texts.map((row, index) => (
          <ZStack
            key={index}
            alignment="topLeading"
            modifiers={[
              frame({
                width: row.width * scale,
                height: row.height * scale,
                alignment: "leading",
              }),
              offset({ x: row.x * scale, y: row.y * scale }),
            ]}
          >
            <Text
              modifiers={[
                font({ family: row.family, size: row.size * scale }),
                foregroundStyle(row.color),
                lineLimit(1),
              ]}
            >
              {row.text}
            </Text>
          </ZStack>
        ))}
      </ZStack>
    </ZStack>
  );
}

export const artlogWidget = createWidget("ArtlogWidget", ArtlogWidget);
