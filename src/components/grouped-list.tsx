import { Button, Host, Icon, ListItem, Row, Text } from '@expo/ui';
import { LabeledContent, List, Section } from '@expo/ui/swift-ui';
import { accessibilityLabel, accessibilityValue, background, buttonStyle, contentShape, font, foregroundStyle, frame, listRowBackground, listStyle, scrollContentBackground, shapes, tint } from '@expo/ui/swift-ui/modifiers';
import type { ComponentProps, ReactNode } from 'react';
import { Gallery } from '@/constants/theme';
import { NativeLoadingRing } from './native-loading-ring';

type IconName = ComponentProps<typeof Icon>['name'];

/** Render as a screen root: the native list needs the available screen frame. */
export function GroupedList({ children }: { children: ReactNode }) {
  return <Host style={{ flex: 1 }} colorScheme="light" seedColor={Gallery.accent}>
    <List modifiers={[listStyle('insetGrouped'), scrollContentBackground('hidden'), background(Gallery.paper), foregroundStyle(Gallery.ink), tint(Gallery.accent)]}>{children}</List>
  </Host>;
}

export function GroupedSection({ modifiers = [], ...props }: ComponentProps<typeof Section>) {
  return <Section {...props} modifiers={[listRowBackground(Gallery.surface), ...modifiers]} />;
}

export function GroupedFooter({ children, tone = 'muted' }: { children: string; tone?: 'muted' | 'destructive' }) {
  return <Text modifiers={[font({ textStyle: 'footnote' })]} textStyle={{ color: tone === 'destructive' ? Gallery.destructive : Gallery.muted }}>{children}</Text>;
}

export function NavigationRow({ label, detail, value, onPress, loading = false }: {
  label: string; detail?: string; value?: string; onPress: () => void; loading?: boolean;
}) {
  return <ListItem trailing={<Row spacing={8} alignment="center">
      {loading ? <NativeLoadingRing label={`Loading ${label.toLowerCase()}`} /> : value ? <Text modifiers={[font({ textStyle: 'subheadline' })]} textStyle={{ color: Gallery.muted }}>{value}</Text> : null}
      <Icon name="chevron.right" size={13} color={Gallery.muted} />
    </Row>}
    modifiers={[accessibilityLabel(label), accessibilityValue(loading ? 'Loading' : value ?? ''), font({ textStyle: 'body' }), frame({ minHeight: 44 })]}
    supportingText={detail ? <Text modifiers={[font({ textStyle: 'footnote' })]} textStyle={{ color: Gallery.muted }}>{detail}</Text> : undefined}
    onPress={onPress}>{label}</ListItem>;
}

export function ActionRow({ label, icon, onPress, disabled = false, destructive = false, busy = false }: {
  label: string; icon?: IconName; onPress: () => void; disabled?: boolean; destructive?: boolean; busy?: boolean;
}) {
  const color = destructive ? Gallery.destructive : Gallery.accent;
  return <Button variant="text" disabled={disabled || busy} onPress={onPress} modifiers={[accessibilityLabel(label), accessibilityValue(busy ? 'In progress' : ''), buttonStyle('borderless'), tint(color), frame({ minHeight: 44 }), ...(destructive ? [listRowBackground(Gallery.destructiveFill)] : [])]}>
    <Row spacing={12} alignment="center" modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), contentShape(shapes.rectangle())]}>
      {busy ? <NativeLoadingRing label={`${label} in progress`} color={color} /> : icon ? <Icon name={icon} size={20} color={color} modifiers={[frame({ width: 28, height: 28 })]} /> : null}
      <Text modifiers={[font({ textStyle: 'body' })]} textStyle={{ color }}>{label}</Text>
    </Row>
  </Button>;
}

export function ValueRow({ label, value, loading = false }: { label: string; value?: string; loading?: boolean }) {
  return <LabeledContent label={label} modifiers={[font({ textStyle: 'body' })]}>{loading ? <NativeLoadingRing label={`Loading ${label.toLowerCase()}`} />
    : <Text modifiers={[font({ textStyle: 'body' })]} textStyle={{ color: Gallery.muted }}>{value}</Text>}</LabeledContent>;
}
