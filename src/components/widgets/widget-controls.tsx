import { Button, Column, Host, Icon, RNHostView, Row, Text as NativeText } from '@expo/ui';
import { accessibilityAddTraits, accessibilityLabel, buttonStyle, contentShape, font, frame, shapes } from '@expo/ui/swift-ui/modifiers';
import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Gallery } from '@/constants/theme';

export function WidgetSettingRow({ title, subtitle, detail, swatch, selected, onPress, children }: {
  title: string; subtitle?: string; detail?: string; swatch?: string; selected?: boolean; onPress: () => void; children?: ReactNode;
}) {
  return <View style={{ borderBottomWidth: .5, borderBottomColor: Gallery.softBorder }}>
    <Host matchContents={{ vertical: true }} colorScheme="light" ignoreSafeArea="all" style={{ width: '100%' }}>
      <Button variant="text" onPress={onPress} modifiers={[buttonStyle('plain'), accessibilityLabel([title, subtitle, detail].filter(Boolean).join(', ')),
        accessibilityAddTraits(selected ? ['isSelected'] : []), frame({ maxWidth: Infinity })]}>
        <Row spacing={12} alignment="center" style={{ paddingVertical: 14 }} modifiers={[frame({ maxWidth: Infinity, minHeight: 58 }), contentShape(shapes.rectangle())]}>
          {!!children && <RNHostView matchContents><View>{children}</View></RNHostView>}
          <Column spacing={5} alignment="start" modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
            <NativeText textStyle={{ color: Gallery.ink }} modifiers={[font({ textStyle: 'body', weight: 'semibold' })]}>{title}</NativeText>
            {!!subtitle && <NativeText textStyle={{ color: Gallery.muted }} modifiers={[font({ textStyle: 'caption' })]}>{subtitle}</NativeText>}
          </Column>
          {!!swatch && <RNHostView matchContents><View style={{ width: 20, height: 20, borderRadius: 4, borderWidth: 1, borderColor: '#92968C', backgroundColor: swatch }} /></RNHostView>}
          {!!detail && <NativeText textStyle={{ color: Gallery.accent }} modifiers={[font({ textStyle: 'subheadline' })]}>{detail}</NativeText>}
          {selected === undefined ? <Icon name="chevron.right" size={13} color={Gallery.accent} />
            : <RNHostView matchContents><View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.2,
              borderColor: selected ? Gallery.ink : '#8E8E99', backgroundColor: selected ? Gallery.highlight : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              {selected && <Image source="sf:checkmark" tintColor={Gallery.ink} accessible={false} style={{ width: 13, height: 13 }} />}
            </View></RNHostView>}
        </Row>
      </Button>
    </Host>
  </View>;
}

export function WidgetTile({ label, selected, onPress, width, children }: { label: string; selected: boolean; onPress: () => void; width: number; children: ReactNode }) {
  return <Host matchContents colorScheme="light" ignoreSafeArea="all" style={{ width }}>
    <Button variant="text" onPress={onPress} modifiers={[buttonStyle('plain'), accessibilityLabel(label), accessibilityAddTraits(selected ? ['isSelected'] : []), frame({ width, minHeight: 44 })]}>
      <RNHostView matchContents><View pointerEvents="none" style={{ width }}>{children}</View></RNHostView>
    </Button>
  </Host>;
}
