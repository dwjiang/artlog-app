import { Host, Icon, Row, Text as NativeText } from '@expo/ui';
import { Menu, Picker, Text as PickerText } from '@expo/ui/swift-ui';
import { accessibilityLabel, buttonStyle, contentShape, frame, pickerStyle, shapes, tag } from '@expo/ui/swift-ui/modifiers';
import { useWindowDimensions, View } from 'react-native';
import { Gallery } from '@/constants/theme';

export function ChoiceMenu<T extends string>({ label, value, options, onChange, grow = 1, plain = false }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; grow?: number; plain?: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  const selected = options.find((option) => option.value === value)?.label;
  return <View style={{ flex: fontScale > 1.4 ? undefined : grow, borderWidth: plain ? 0 : 0.5, borderColor: Gallery.controlBorder, borderRadius: 4 }}>
    <Host matchContents={{ vertical: true }} colorScheme="light" style={{ width: '100%' }}>
      <Menu modifiers={[accessibilityLabel(`${label}: ${selected}`), buttonStyle('plain'), frame({ maxWidth: Infinity })]}
        label={<Row spacing={8} alignment="center" style={{ paddingHorizontal: 11 }} modifiers={[frame({ maxWidth: Infinity, minHeight: 44 * Math.max(1, fontScale) }), contentShape(shapes.rectangle())]}>
          <NativeText textStyle={{ fontSize: 15 * fontScale, fontWeight: '400', color: plain ? Gallery.accent : Gallery.ink }} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>{selected}</NativeText>
          <Icon name="chevron.down" size={11} color={plain ? Gallery.accent : Gallery.muted} />
        </Row>}>
        <Picker label={label} selection={value} onSelectionChange={onChange} modifiers={[pickerStyle('inline')]}>
          {options.map((option) => <PickerText key={option.value} modifiers={[tag(option.value)]}>{option.label}</PickerText>)}
        </Picker>
      </Menu>
    </Host>
  </View>;
}
