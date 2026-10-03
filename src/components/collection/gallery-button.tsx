import { Button, Host, Icon, Row, Text as NativeText } from "@expo/ui";
import {
  accessibilityLabel as accessibilityLabelModifier,
  accessibilityValue,
  buttonStyle,
  contentShape,
  fixedSize,
  font,
  frame,
  multilineTextAlignment,
  opacity,
  shapes,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import * as Sentry from "@sentry/react-native";
import { type ComponentProps, useEffect } from "react";
import { AccessibilityInfo, StyleSheet, View, useWindowDimensions } from "react-native";

import { LoadingRing } from "@/components/loading-ring";
import { Gallery, Radius, Spacing } from "@/constants/theme";

export function GalleryButton({
  label,
  accessibilityLabel = label,
  icon,
  iconPosition = "leading",
  contentAlignment = "center",
  onPress,
  disabled,
  busy = false,
  busyLabel = "Working…",
  variant = "text",
  inverse = false,
  fullWidth,
  destructive = false,
  tone = "accent",
  size = "regular",
  minHeight: minHeightOverride,
  iconOnly = false,
  cornerRadius = Radius.button,
  maskInReplay = false,
}: {
  label: string;
  accessibilityLabel?: string;
  icon?: ComponentProps<typeof Icon>["name"];
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  iconPosition?: "leading" | "trailing";
  contentAlignment?: "center" | "leading";
  busyLabel?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  inverse?: boolean;
  fullWidth?: boolean;
  destructive?: boolean;
  /** `neutral` fills with the paper fill and ink text: a quiet secondary next to a filled primary. */
  tone?: "accent" | "ink" | "neutral";
  size?: "regular" | "compact";
  minHeight?: number;
  /** Draws only `icon`; `label` remains the accessible name. */
  iconOnly?: boolean;
  cornerRadius?: number;
  maskInReplay?: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  const expand = fullWidth ?? fontScale >= 1.5;
  const accent = destructive
    ? Gallery.destructive
    : inverse
      ? Gallery.surface
      : tone === "ink"
        ? Gallery.ink
        : tone === "neutral"
          ? Gallery.fill
          : Gallery.accent;
  const foreground = variant === "filled" ? (inverse || tone === "neutral" ? Gallery.ink : Gallery.surface) : accent;
  const minHeight = minHeightOverride ?? (variant === "filled" && expand ? (size === "compact" ? 48 : 52) : 44);
  useEffect(() => {
    if (busy) {
      AccessibilityInfo.announceForAccessibility(`${accessibilityLabel}. In progress.`);
    }
  }, [busy, accessibilityLabel]);
  const Container = maskInReplay ? Sentry.Mask : View;

  // The row lets the inner view hug the native button so the overlay covers only it, while a centered parent can still center the whole row.
  return (
    <Container
      style={{
        flexDirection: "row",
        maxWidth: "100%",
        ...(expand ? { width: "100%" } : {}),
      }}
    >
      <View style={{ maxWidth: "100%", ...(expand ? { flex: 1 } : {}) }}>
        {/* The enclosing screen handles insets; native safe areas would displace labels as the button scrolls. */}
        <Host
          key={fontScale}
          matchContents={expand ? { vertical: true } : true}
          ignoreSafeArea="all"
          colorScheme="light"
          seedColor={accent}
          style={{
            maxWidth: "100%",
            borderRadius: cornerRadius,
            backgroundColor: variant === "filled" ? accent : "transparent",
            borderWidth: variant === "outlined" ? 1 : 0,
            borderColor: destructive ? Gallery.destructive : Gallery.accentBorder,
            opacity: disabled && !busy ? 0.5 : 1,
            ...(expand ? { width: "100%" } : {}),
          }}
        >
          <Button
            onPress={onPress}
            disabled={disabled || busy}
            variant={variant}
            style={{
              paddingHorizontal: variant === "text" ? 0 : Spacing.compact,
            }}
            modifiers={[
              accessibilityLabelModifier(accessibilityLabel),
              accessibilityValue(busy ? busyLabel : ""),
              frame({ minHeight, ...(expand ? { maxWidth: Infinity } : {}) }),
              buttonStyle("plain"),
              tint(accent),
            ]}
          >
            <Row
              spacing={Spacing.two}
              alignment="center"
              modifiers={[
                frame({
                  minHeight,
                  minWidth: 44,
                  alignment: contentAlignment,
                  ...(expand ? { maxWidth: Infinity } : {}),
                }),
                contentShape(shapes.rectangle()),
                opacity(busy ? 0 : 1),
              ]}
            >
              {icon && iconPosition === "leading" && (
                <Icon name={icon} size={17} color={foreground} modifiers={[frame({ width: 24 })]} />
              )}
              {!iconOnly && (
                <NativeText
                  textStyle={{ color: foreground }}
                  modifiers={[
                    font({
                      textStyle: size === "compact" ? "callout" : "body",
                      weight: variant === "filled" ? "semibold" : "regular",
                    }),
                    fixedSize({ horizontal: false, vertical: true }),
                    multilineTextAlignment(contentAlignment),
                  ]}
                >
                  {label}
                </NativeText>
              )}
              {icon && iconPosition === "trailing" && <Icon name={icon} size={17} color={foreground} />}
            </Row>
          </Button>
        </Host>
        {/* Native content reserves the size; the overlay keeps busy feedback legible over SwiftUI's disabled appearance. */}
        {busy && (
          <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[
              StyleSheet.absoluteFill,
              {
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: Spacing.two,
                paddingHorizontal: Spacing.two,
                borderRadius: cornerRadius,
                backgroundColor: variant === "filled" ? accent : undefined,
              },
            ]}
          >
            <LoadingRing color={foreground} accessible={false} />
          </View>
        )}
      </View>
    </Container>
  );
}
