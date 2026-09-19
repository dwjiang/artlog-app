import { Button, Host, Icon, Row, Text as NativeText } from '@expo/ui';
import { accessibilityLabel as accessibilityLabelModifier, accessibilityValue, buttonStyle, contentShape, fixedSize, font, frame, opacity, shapes, tint } from '@expo/ui/swift-ui/modifiers';
import { type ComponentProps, useEffect } from 'react';
import { AccessibilityInfo, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gallery, Radius, Spacing } from '@/constants/theme';
import { LoadingRing } from '@/components/loading-ring';
import { ThemedText } from '@/components/themed-text';

export function GalleryButton({ label, accessibilityLabel = label, icon, iconPosition = 'leading', onPress, disabled, busy = false, busyLabel = 'Working…', variant = 'text', inverse = false, fullWidth, destructive = false, tone = 'accent' }: {
  label: string; accessibilityLabel?: string; icon?: ComponentProps<typeof Icon>['name']; onPress: () => void; disabled?: boolean; busy?: boolean;
  iconPosition?: 'leading' | 'trailing';
  busyLabel?: string;
  variant?: ComponentProps<typeof Button>['variant'];
  inverse?: boolean;
  fullWidth?: boolean;
  destructive?: boolean;
  tone?: 'accent' | 'ink';
}) {
  const { fontScale } = useWindowDimensions();
  const expand = fullWidth ?? fontScale >= 1.5;
  const accent = destructive ? Gallery.destructive : inverse ? Gallery.surface : tone === 'ink' ? Gallery.ink : Gallery.accent;
  const foreground = variant === 'filled' ? inverse ? Gallery.ink : Gallery.surface : accent;
  useEffect(() => {
    if (busy) AccessibilityInfo.announceForAccessibility(`${accessibilityLabel}. In progress.`);
  }, [busy, accessibilityLabel]);

  // The row lets the inner view hug the native button so the overlay covers only it, while a centered parent can still center the whole row.
  return <View style={{ flexDirection: 'row', maxWidth: '100%', ...(expand ? { width: '100%' } : {}) }}>
    <View style={{ maxWidth: '100%', ...(expand ? { flex: 1 } : {}) }}>
    <Host key={fontScale} matchContents={expand ? { vertical: true } : true} colorScheme="light" seedColor={accent}
      style={{ maxWidth: '100%', borderRadius: Radius.button, backgroundColor: variant === 'filled' ? accent : 'transparent',
        borderWidth: variant === 'outlined' ? 1 : 0, borderColor: accent, opacity: disabled && !busy ? 0.5 : 1, ...(expand ? { width: '100%' } : {}) }}>
    <Button onPress={onPress} disabled={disabled || busy} variant={variant}
      style={{ paddingHorizontal: variant === 'text' ? 0 : Spacing.compact }}
      modifiers={[accessibilityLabelModifier(accessibilityLabel), accessibilityValue(busy ? busyLabel : ''),
        frame({ minHeight: 44, ...(expand ? { maxWidth: Infinity } : {}) }),
        buttonStyle('plain'), tint(accent)]}>
        <Row spacing={Spacing.two} alignment="center" modifiers={[frame({ minHeight: 44, minWidth: 44, ...(expand ? { maxWidth: Infinity } : {}) }), contentShape(shapes.rectangle()), opacity(busy ? 0 : 1)]}>
          {icon && iconPosition === 'leading' && <Icon name={icon} size={17} color={foreground} />}
          <NativeText textStyle={{ color: foreground }} modifiers={[font({ textStyle: 'body', weight: variant === 'filled' ? 'semibold' : 'regular' }), fixedSize({ horizontal: false, vertical: true })]}>{label}</NativeText>
          {icon && iconPosition === 'trailing' && <Icon name={icon} size={17} color={foreground} />}
        </Row>
    </Button>
    </Host>
    {/* Native content reserves the size; the overlay keeps busy feedback legible over SwiftUI's disabled appearance. */}
    {busy && <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two, paddingHorizontal: Spacing.two,
        borderRadius: Radius.button, backgroundColor: variant === 'filled' ? accent : undefined }]}>
      <LoadingRing color={foreground} accessible={false} />
      {expand && <ThemedText variant="button" accessible={false} style={{ color: foreground, flexShrink: 1, textAlign: 'center' }}>{busyLabel}</ThemedText>}
    </View>}
    </View>
  </View>;
}
