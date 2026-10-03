import { Button, Column, Host, RNHostView, Text as NativeText } from "@expo/ui";
import {
  accessibilityAddTraits,
  accessibilityLabel,
  background,
  buttonStyle,
  contentShape,
  frame,
  padding,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";

import { Gallery } from "@/constants/theme";
import { wallAspect, type WallFrame as Frame, type WallPiece } from "@/lib/wall/wall-layout";
import { wallFrameInset, WALL_FRAMES as wallFrames } from "@/shared/wall/frames";

import { WallArtwork } from "./wall-artwork";
import { WallFrame } from "./wall-frame";

function WallChoice({
  label,
  selected,
  onPress,
  children,
  width = 68,
  disabled = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  children: ReactNode;
  width?: number;
  disabled?: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  return (
    <Host matchContents colorScheme="light" seedColor={Gallery.accent}>
      <Button
        variant="text"
        onPress={onPress}
        disabled={disabled}
        style={{ paddingVertical: 4 }}
        modifiers={[
          buttonStyle("plain"),
          frame({ width: width * fontScale, minHeight: 72 }),
          accessibilityLabel(label),
          accessibilityAddTraits(selected ? ["isSelected"] : []),
        ]}
      >
        <Column
          spacing={7}
          alignment="center"
          modifiers={[frame({ maxWidth: Infinity, minHeight: 72 }), contentShape(shapes.rectangle())]}
        >
          <RNHostView matchContents>
            <View pointerEvents="none" style={styles.preview}>
              {children}
            </View>
          </RNHostView>
          <NativeText
            modifiers={[
              padding({ horizontal: 6, vertical: 2 }),
              background(selected ? Gallery.highlight : "transparent"),
            ]}
            textStyle={{
              fontSize: 13 * fontScale,
              fontWeight: selected ? "600" : "400",
              color: selected ? Gallery.accent : Gallery.muted,
            }}
          >
            {label}
          </NativeText>
        </Column>
      </Button>
    </Host>
  );
}

export function WallFramePicker({
  value,
  onChange,
  disabled = false,
  piece,
}: {
  value: Frame;
  onChange: (value: Frame) => void;
  disabled?: boolean;
  piece?: WallPiece;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.frames}>
      {wallFrames.map((finish) => (
        <WallChoice
          key={finish.value}
          label={finish.name}
          width={94}
          selected={finish.value === value}
          disabled={disabled}
          onPress={() => onChange(finish.value)}
        >
          {piece ? (
            <WallArtwork
              piece={{
                ...piece,
                layout: { ...piece.layout, frame: finish.value },
              }}
              width={Math.min(64, 48 * wallAspect(piece))}
            />
          ) : (
            <WallFrame frame={finish.value} width={38} height={28}>
              <View
                style={{
                  width: 38 - wallFrameInset(finish.value, 38) * 2,
                  height: 28 - wallFrameInset(finish.value, 38) * 2,
                  backgroundColor: Gallery.fill,
                }}
              />
            </WallFrame>
          )}
        </WallChoice>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  preview: {
    width: 70,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  frames: { paddingHorizontal: 0, gap: 8, paddingBottom: 4 },
});
