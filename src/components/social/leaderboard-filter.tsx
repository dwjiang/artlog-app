import { Host, Icon, Row, Text as NativeText } from '@expo/ui';
import { Menu, Picker, Text as PickerText } from '@expo/ui/swift-ui';
import { accessibilityLabel, buttonStyle, frame, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useWindowDimensions, View } from 'react-native';
import { Gallery } from '@/constants/theme';

export function LeaderboardFilter<T extends string>({ label, value, options, onChange, grow = 1 }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; grow?: number;
}) {
  const { fontScale } = useWindowDimensions();
  const selected = options.find((option) => option.value === value)?.label;
  return <View style={{ flex: fontScale > 1.4 ? undefined : grow, borderWidth: 0.5, borderColor: Gallery.controlBorder, borderRadius: 6 }}>
    <Host matchContents={{ vertical: true }} colorScheme="light" style={{ width: '100%' }}>
      <Menu modifiers={[accessibilityLabel(`${label}: ${selected}`), buttonStyle('plain'), frame({ maxWidth: Infinity })]}
        label={<Row spacing={8} alignment="center" style={{ paddingHorizontal: 11 }} modifiers={[frame({ maxWidth: Infinity, minHeight: 44 * Math.max(1, fontScale) })]}>
          <NativeText textStyle={{ fontSize: 13 * fontScale, fontWeight: '500', color: Gallery.ink }} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>{selected}</NativeText>
          <Icon name="chevron.down" size={11} color={Gallery.muted} />
        </Row>}>
        <Picker label={label} selection={value} onSelectionChange={onChange} modifiers={[pickerStyle('inline')]}>
          {options.map((option) => <PickerText key={option.value} modifiers={[tag(option.value)]}>{option.label}</PickerText>)}
        </Picker>
      </Menu>
    </Host>
  </View>;
}
