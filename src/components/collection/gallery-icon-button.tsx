import { Button, Host, Icon } from '@expo/ui';
import { accessibilityLabel, accessibilityValue, contentShape, frame, shapes, tint } from '@expo/ui/swift-ui/modifiers';
import type { ComponentProps } from 'react';
import { Gallery } from '@/constants/theme';
import { NativeLoadingRing } from '../native-loading-ring';

export function GalleryIconButton({ label, icon, onPress, disabled = false, busy = false, tone = 'ink' }: {
  label: string; icon: ComponentProps<typeof Icon>['name']; onPress: () => void; disabled?: boolean; busy?: boolean; tone?: 'accent' | 'ink';
}) {
  const color = Gallery[tone];
  return <Host colorScheme="light" style={{ width: 44, height: 44 }}>
    <Button variant="text" onPress={onPress} disabled={disabled || busy}
      modifiers={[accessibilityLabel(label), accessibilityValue(busy ? 'In progress' : ''), frame({ minWidth: 44, minHeight: 44 }), tint(color)]}>
      {busy ? <NativeLoadingRing label={`${label} in progress`} color={color} />
        : <Icon name={icon} size={21} color={color} modifiers={[frame({ width: 44, height: 44 }), contentShape(shapes.rectangle())]} />}
    </Button>
  </Host>;
}
