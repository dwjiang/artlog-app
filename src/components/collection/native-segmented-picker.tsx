import type { ComponentProps } from 'react';
import { useWindowDimensions } from 'react-native';
import { Button, Column, Host, Icon, Row, Text } from '@expo/ui';
import { accessibilityAddTraits, accessibilityElement, accessibilityLabel, background, contentShape, font, frame, shapes } from '@expo/ui/swift-ui/modifiers';
import { Gallery, Spacing } from '@/constants/theme';

export function NativeSegmentedPicker<T extends string>({ label, value, options, onChange, disabled = false, compact = false }: {
  label: string; value?: T; options: { value: T; label: string; icon?: ComponentProps<typeof Icon>['name'] }[];
  onChange: (value: T) => void; disabled?: boolean; compact?: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= 1.5;
  const Layout = stacked ? Column : Row;
  const fillWidth = !compact || stacked;
  return <Host key={fontScale} matchContents={fillWidth ? { vertical: true } : true} colorScheme="light" style={fillWidth ? { width: '100%' } : undefined}>
    <Layout alignment="center" spacing={1}
      style={{ backgroundColor: Gallery.controlBorder, borderColor: Gallery.controlBorder, borderWidth: 0.5, borderRadius: 4, opacity: disabled ? 0.55 : 1 }}
      modifiers={[accessibilityElement('contain'), accessibilityLabel(label), ...(fillWidth ? [frame({ maxWidth: Infinity })] : [])]}>
      {options.map((option) => {
        const selected = option.value === value;
        return <Button key={option.value} variant="text" disabled={disabled} onPress={() => onChange(option.value)}
          modifiers={[accessibilityLabel(option.label), accessibilityAddTraits(selected ? ['isSelected'] : []),
            ...(fillWidth ? [frame({ maxWidth: Infinity })] : [])]}>
          <Row alignment="center" spacing={Spacing.one} style={{ paddingHorizontal: Spacing.two, paddingVertical: Spacing.two }} modifiers={[
            frame({ ...(fillWidth ? { maxWidth: Infinity } : {}), minHeight: 44 }),
            contentShape(shapes.rectangle()),
            background(selected ? Gallery.segmentSelection : Gallery.segmentTrack, shapes.rectangle()),
          ]}>
            {option.icon && <Icon name={option.icon} size={17} color={Gallery.ink} />}
            <Text textStyle={{ color: Gallery.ink }} modifiers={[font({ textStyle: compact ? 'subheadline' : 'body', weight: selected ? 'semibold' : 'regular' })]}>{option.label}</Text>
          </Row>
        </Button>;
      })}
    </Layout>
  </Host>;
}
