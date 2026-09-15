import type { ComponentProps } from 'react';
import { useWindowDimensions } from 'react-native';
import { Button, Host, Icon, Row, Text } from '@expo/ui';
import { accessibilityAddTraits, accessibilityElement, accessibilityLabel, background, frame, shadow, shapes } from '@expo/ui/swift-ui/modifiers';
import { Gallery } from '@/constants/theme';

export function NativeSegmentedPicker<T extends string>({ label, value, options, onChange, disabled = false, compact = false }: {
  label: string; value?: T; options: { value: T; label: string; icon?: ComponentProps<typeof Icon>['name'] }[];
  onChange: (value: T) => void; disabled?: boolean; compact?: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  const height = (compact ? 32 : 33) * Math.max(1, fontScale);
  return <Host matchContents={compact ? true : { vertical: true }} colorScheme="light" style={compact ? undefined : { width: '100%' }}>
    <Row alignment="center" spacing={compact ? 1 : 0}
      style={{ padding: compact ? 3 : 2, backgroundColor: compact ? '#E5E5DE' : Gallery.segmentTrack,
        borderRadius: compact ? 8 : 10, opacity: disabled ? 0.55 : 1 }}
      modifiers={[accessibilityElement('contain'), accessibilityLabel(label), ...(!compact ? [frame({ maxWidth: Infinity })] : [])]}>
      {options.map((option) => <Button key={option.value} variant="text" disabled={disabled} onPress={() => onChange(option.value)}
        modifiers={[accessibilityLabel(option.label), accessibilityAddTraits(option.value === value ? ['isSelected'] : [])]}>
        <Row alignment="center" spacing={4} style={{ paddingHorizontal: compact ? 9 : 0 }} modifiers={[
          // Fixed height would make Expo UI ignore maxWidth.
          frame({ ...(!compact ? { maxWidth: Infinity } : {}), minHeight: height, maxHeight: height }),
          background(option.value === value ? (compact ? Gallery.surface : Gallery.segmentSelection) : 'transparent',
            shapes.roundedRectangle({ cornerRadius: compact ? 6 : 7 })),
          ...(option.value === value ? [shadow({ color: compact ? '#00000011' : '#00000022', radius: compact ? 1.5 : 2, y: 1 })] : []),
        ]}>
          {option.icon && <Icon name={option.icon} size={14 * fontScale} color={Gallery.ink} />}
          <Text textStyle={{ fontSize: (compact ? 11 : 14) * fontScale, fontWeight: compact ? '500' : '600', color: Gallery.ink }}>{option.label}</Text>
        </Row>
      </Button>)}
    </Row>
  </Host>;
}
