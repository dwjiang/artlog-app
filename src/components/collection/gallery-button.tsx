import { Button, Host, Icon, Row, Text as NativeText } from '@expo/ui';
import { buttonBorderShape, frame, tint } from '@expo/ui/swift-ui/modifiers';
import type { ComponentProps } from 'react';
import { useWindowDimensions } from 'react-native';
import { Gallery } from '@/constants/theme';

export function GalleryButton({ label, icon, iconPosition = 'leading', onPress, disabled, variant = 'text', inverse = false, fullWidth = false, destructive = false, capsule = false }: {
  label: string; icon?: ComponentProps<typeof Icon>['name']; onPress: () => void; disabled?: boolean;
  iconPosition?: 'leading' | 'trailing';
  variant?: ComponentProps<typeof Button>['variant'];
  inverse?: boolean;
  fullWidth?: boolean;
  destructive?: boolean;
  capsule?: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  const accent = destructive ? Gallery.destructive : inverse ? Gallery.paper : Gallery.accent;
  const foreground = variant === 'filled' ? inverse ? Gallery.ink : Gallery.paper : destructive ? Gallery.destructive : Gallery.ink;
  return <Host matchContents={fullWidth ? { vertical: true } : true} colorScheme="light" seedColor={accent}
    style={{ maxWidth: '100%', ...(fullWidth ? { width: '100%' } : {}) }}>
    <Button onPress={onPress} disabled={disabled} variant={variant}
      style={{ paddingVertical: variant === 'text' ? 0 : 8, paddingHorizontal: variant === 'text' ? 0 : 12 }}
      modifiers={[frame({ minHeight: 44, ...(fullWidth ? { maxWidth: Infinity } : {}) }), capsule ? buttonBorderShape('capsule') : buttonBorderShape('roundedRectangle', 11), tint(accent)]}>
      <Row spacing={5} alignment="center" modifiers={fullWidth ? [frame({ maxWidth: Infinity })] : undefined}>
        {icon && iconPosition === 'leading' && <Icon name={icon} size={15} color={foreground} />}
        <NativeText textStyle={{ fontSize: (variant === 'text' ? 13 : 14) * fontScale, fontWeight: '500', color: foreground }}>{label}</NativeText>
        {icon && iconPosition === 'trailing' && <Icon name={icon} size={15} color={foreground} />}
      </Row>
    </Button>
  </Host>;
}
