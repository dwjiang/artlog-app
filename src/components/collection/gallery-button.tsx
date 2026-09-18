import { ProgressView, ZStack } from '@expo/ui/swift-ui';
import { Button, Host, Icon, Row, Text as NativeText } from '@expo/ui';
import { accessibilityLabel as accessibilityLabelModifier, accessibilityValue, buttonBorderShape, contentShape, fixedSize, font, frame, opacity, shapes, tint } from '@expo/ui/swift-ui/modifiers';
import { type ComponentProps, useEffect } from 'react';
import { AccessibilityInfo, useWindowDimensions } from 'react-native';
import { Gallery, Radius, Spacing } from '@/constants/theme';

export function GalleryButton({ label, accessibilityLabel = label, icon, iconPosition = 'leading', onPress, disabled, busy = false, variant = 'text', inverse = false, fullWidth, destructive = false, tone = 'accent' }: {
  label: string; accessibilityLabel?: string; icon?: ComponentProps<typeof Icon>['name']; onPress: () => void; disabled?: boolean; busy?: boolean;
  iconPosition?: 'leading' | 'trailing';
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

  return <Host key={fontScale} matchContents={expand ? { vertical: true } : true} colorScheme="light" seedColor={accent}
    style={{ maxWidth: '100%', ...(expand ? { width: '100%' } : {}) }}>
    <Button onPress={onPress} disabled={disabled || busy} variant={variant}
      style={{ paddingVertical: Spacing.two, paddingHorizontal: variant === 'text' ? 0 : Spacing.compact }}
      modifiers={[accessibilityLabelModifier(accessibilityLabel), accessibilityValue(busy ? 'In progress' : ''),
        frame({ minHeight: 44, ...(expand ? { maxWidth: Infinity } : {}) }),
        buttonBorderShape('roundedRectangle', Radius.button), tint(accent)]}>
      <ZStack>
        <Row spacing={Spacing.two} alignment="center" modifiers={[frame({ minHeight: 44, minWidth: 44, ...(expand ? { maxWidth: Infinity } : {}) }), contentShape(shapes.rectangle()), opacity(busy ? 0 : 1)]}>
          {icon && iconPosition === 'leading' && <Icon name={icon} size={17} color={foreground} />}
          <NativeText textStyle={{ color: foreground }} modifiers={[font({ textStyle: 'body', weight: 'semibold' }), fixedSize({ horizontal: false, vertical: true })]}>{label}</NativeText>
          {icon && iconPosition === 'trailing' && <Icon name={icon} size={17} color={foreground} />}
        </Row>
        {busy && <ProgressView modifiers={[tint(foreground)]} />}
      </ZStack>
    </Button>
  </Host>;
}
