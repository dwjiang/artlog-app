import { Button, Host, Icon, ListItem, Row, Text } from '@expo/ui';
import { LabeledContent, List, Section } from '@expo/ui/swift-ui';
import { background, buttonStyle, font, foregroundStyle, frame, listRowBackground, listStyle, scrollContentBackground, tint } from '@expo/ui/swift-ui/modifiers';
import type { ComponentProps, ReactNode } from 'react';
import { Gallery } from '@/constants/theme';

type IconName = ComponentProps<typeof Icon>['name'];

/** Render as a screen root: the native list needs the available screen frame. */
export function GroupedList({ children }: { children: ReactNode }) {
  return <Host style={{ flex: 1 }} colorScheme="light" seedColor={Gallery.accent}>
    <List modifiers={[listStyle('plain'), scrollContentBackground('hidden'), background(Gallery.paper), foregroundStyle(Gallery.ink), tint(Gallery.accent)]}>{children}</List>
  </Host>;
}

/** Plain lists paint rows with the system background, so every section sets its rows on paper. */
export function GroupedSection({ modifiers = [], ...props }: ComponentProps<typeof Section>) {
  return <Section {...props} modifiers={[listRowBackground(Gallery.paper), ...modifiers]} />;
}

export function GroupedFooter({ children, tone = 'muted' }: { children: string; tone?: 'muted' | 'destructive' }) {
  return <Text modifiers={[font({ textStyle: 'footnote' })]} textStyle={{ color: tone === 'destructive' ? Gallery.destructive : Gallery.muted }}>{children}</Text>;
}

export function NavigationRow({ label, detail, value, onPress }: {
  label: string; detail?: string; value?: string; onPress: () => void;
}) {
  return <ListItem trailing={<Row spacing={8} alignment="center">
      {value ? <Text modifiers={[font({ textStyle: 'subheadline' })]} textStyle={{ color: Gallery.muted }}>{value}</Text> : null}
      <Icon name="chevron.right" size={13} color={Gallery.muted} />
    </Row>}
    modifiers={[font({ textStyle: 'body' }), frame({ minHeight: 44 })]}
    supportingText={detail ? <Text modifiers={[font({ textStyle: 'footnote' })]} textStyle={{ color: Gallery.muted }}>{detail}</Text> : undefined}
    onPress={onPress}>{label}</ListItem>;
}

export function ActionRow({ label, icon, onPress, disabled = false, destructive = false }: {
  label: string; icon?: IconName; onPress: () => void; disabled?: boolean; destructive?: boolean;
}) {
  const color = destructive ? Gallery.destructive : Gallery.accent;
  return <Button variant="text" disabled={disabled} onPress={onPress} modifiers={[buttonStyle('borderless'), tint(color), frame({ minHeight: 44 })]}>
    <Row spacing={12} alignment="center">
      {icon ? <Icon name={icon} size={20} color={color} modifiers={[frame({ width: 28, height: 28 })]} /> : null}
      <Text modifiers={[font({ textStyle: 'body' })]} textStyle={{ color }}>{label}</Text>
    </Row>
  </Button>;
}

export function ValueRow({ label, value }: { label: string; value: string }) {
  return <LabeledContent label={label} modifiers={[font({ textStyle: 'body' })]}><Text modifiers={[font({ textStyle: 'body' })]} textStyle={{ color: Gallery.muted }}>{value}</Text></LabeledContent>;
}
