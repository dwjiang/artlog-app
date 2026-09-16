import { Button, Host, Icon } from '@expo/ui';
import { accessibilityLabel, frame } from '@expo/ui/swift-ui/modifiers';
import type { ComponentProps } from 'react';
import { Gallery } from '@/constants/theme';

export function GalleryIconButton({ label, icon, onPress, disabled = false }: {
  label: string; icon: ComponentProps<typeof Icon>['name']; onPress: () => void; disabled?: boolean;
}) {
  return <Host matchContents colorScheme="light">
    <Button variant="text" onPress={onPress} disabled={disabled} modifiers={[accessibilityLabel(label), frame({ width: 44, height: 44 })]}>
      <Icon name={icon} size={21} color={Gallery.ink} />
    </Button>
  </Host>;
}
