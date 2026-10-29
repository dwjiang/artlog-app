import { Button, Column, Host, Icon, Row, Text } from "@expo/ui";
import { Background, Namespace, RoundedRectangle } from "@expo/ui/swift-ui";
import {
  accessibilityAddTraits,
  accessibilityElement,
  accessibilityLabel,
  Animation,
  animation,
  buttonStyle,
  contentShape,
  dynamicTypeSize,
  font,
  foregroundStyle,
  frame,
  matchedGeometryEffect,
  opacity,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import { useId, type ComponentProps } from "react";
import { useWindowDimensions } from "react-native";

import { CompactBarMaxTypeSize, Gallery, Motion, Radius, Spacing } from "@/constants/theme";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { playSelectionHaptic } from "@/lib/ui/haptics";

const SEGMENT_MIN_HEIGHT = 44;

export function NativeSegmentedPicker<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  compact = false,
  grouped = false,
  singleRow = false,
}: {
  label: string;
  value?: T;
  options: {
    value: T;
    label: string;
    icon?: ComponentProps<typeof Icon>["name"];
  }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  compact?: boolean;
  /** Darkens the track, which otherwise matches a grouped (gray) page. */
  grouped?: boolean;
  /**
   * Keeps short labels side by side at the largest text sizes, as iOS segmented controls do: like a tab bar's, they
   * stop growing at the largest standard size.
   */
  singleRow?: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  const reduced = useReducedMotion();
  const namespace = useId();
  const stacked = !singleRow && fontScale >= 1.5;
  const Layout = stacked ? Column : Row;
  const fillWidth = !compact || stacked;
  const selectedIndex = options.findIndex((option) => option.value === value);
  const track = grouped ? Gallery.separator : Gallery.segmentTrack;
  // Segments and the track's padding at their minimum, so Yoga reserves the control before SwiftUI first sizes it.
  const rows = stacked ? options.length : 1;
  const minHeight = rows * SEGMENT_MIN_HEIGHT + (rows - 1) * Spacing.one + 2 * Spacing.one;
  return (
    <Host
      key={fontScale}
      matchContents={fillWidth ? { vertical: true } : true}
      colorScheme="light"
      style={{ minHeight, ...(fillWidth ? { width: "100%" } : {}) }}
    >
      <Namespace id={namespace}>
        <Layout
          alignment="center"
          spacing={Spacing.one}
          style={{
            backgroundColor: track,
            borderRadius: Radius.input,
            padding: Spacing.one,
          }}
          modifiers={[
            accessibilityElement("contain"),
            accessibilityLabel(label),
            ...(singleRow ? [dynamicTypeSize({ max: CompactBarMaxTypeSize })] : []),
            ...(fillWidth ? [frame({ maxWidth: Infinity })] : []),
            opacity(disabled ? 0.55 : 1),
            // The selection slides to the chosen segment: its shape carries one geometry id across them.
            ...(reduced ? [] : [animation(Animation.easeOut({ duration: Motion.state / 1000 }), selectedIndex)]),
          ]}
        >
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <Button
                key={option.value}
                variant="text"
                disabled={disabled}
                onPress={() => {
                  if (!selected) playSelectionHaptic();
                  onChange(option.value);
                }}
                modifiers={[
                  buttonStyle("plain"),
                  accessibilityLabel(option.label),
                  accessibilityAddTraits(selected ? ["isSelected"] : []),
                  ...(fillWidth ? [frame({ maxWidth: Infinity })] : []),
                ]}
              >
                <Background>
                  <Row
                    alignment="center"
                    spacing={Spacing.one}
                    style={{
                      paddingHorizontal: Spacing.two,
                      paddingVertical: Spacing.two,
                    }}
                    modifiers={[
                      frame({
                        ...(fillWidth ? { maxWidth: Infinity } : {}),
                        minHeight: SEGMENT_MIN_HEIGHT,
                      }),
                      contentShape(shapes.rectangle()),
                    ]}
                  >
                    {option.icon && (
                      <Icon name={option.icon} size={17} color={selected ? Gallery.accent : Gallery.muted} />
                    )}
                    <Text
                      textStyle={{
                        color: selected ? Gallery.accent : Gallery.muted,
                      }}
                      modifiers={[
                        font({
                          textStyle: "subheadline",
                          weight: selected ? "semibold" : "regular",
                        }),
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Row>
                  <Background.Content>
                    {selected ? (
                      <RoundedRectangle
                        cornerRadius={Radius.input - Spacing.half}
                        modifiers={[
                          foregroundStyle(Gallery.segmentSelection),
                          matchedGeometryEffect("selection", namespace),
                        ]}
                      />
                    ) : (
                      <RoundedRectangle
                        cornerRadius={Radius.input - Spacing.half}
                        modifiers={[foregroundStyle(track)]}
                      />
                    )}
                  </Background.Content>
                </Background>
              </Button>
            );
          })}
        </Layout>
      </Namespace>
    </Host>
  );
}
