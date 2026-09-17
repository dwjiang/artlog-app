import { Button, Host, Icon, ListItem, Row, Text } from '@expo/ui';
import { LabeledContent, List } from '@expo/ui/swift-ui';
import { background, buttonStyle, foregroundStyle, frame, listStyle, scrollContentBackground, tint } from '@expo/ui/swift-ui/modifiers';
import type { ComponentProps, ReactNode } from 'react';
import { Gallery } from '@/constants/theme';

type IconName = ComponentProps<typeof Icon>['name'];

/** The inset-grouped iOS list behind Settings-style screens. Render it as the screen's root: a List only sizes itself from a real frame. */
export function GroupedList({ children }: { children: ReactNode }) {
  return <Host style={{ flex: 1 }} colorScheme="light" seedColor={Gallery.accent}>
    <List modifiers={[listStyle('insetGrouped'), scrollContentBackground('hidden'), background(Gallery.paper), foregroundStyle(Gallery.ink)]}>{children}</List>
  </Host>;
}

export function GroupedFooter({ children, tone = 'muted' }: { children: string; tone?: 'muted' | 'destructive' }) {
  return <Text textStyle={{ fontSize: 12, color: tone === 'destructive' ? Gallery.destructive : Gallery.muted }}>{children}</Text>;
}

export function NavigationRow({ label, icon, detail, value, onPress }: {
  label: string; icon?: IconName; detail?: string; value?: string; onPress: () => void;
}) {
  return <ListItem leading={icon ? <Icon name={icon} size={22} color={Gallery.accent} modifiers={[frame({ width: 28, height: 28 })]} /> : undefined}
    trailing={<Row spacing={6} alignment="center">
      {value ? <Text textStyle={{ fontSize: 15, color: Gallery.muted }}>{value}</Text> : null}
      <Icon name="chevron.right" size={12} color={Gallery.muted} />
    </Row>}
    supportingText={detail ? <Text textStyle={{ fontSize: 13, color: Gallery.muted }}>{detail}</Text> : undefined}
    onPress={onPress}>{label}</ListItem>;
}

export function ActionRow({ label, icon, onPress, disabled = false, destructive = false }: {
  label: string; icon?: IconName; onPress: () => void; disabled?: boolean; destructive?: boolean;
}) {
  const color = destructive ? Gallery.destructive : Gallery.accent;
  return <Button variant="text" disabled={disabled} onPress={onPress} modifiers={[buttonStyle('borderless'), tint(color)]}>
    <Row spacing={12} alignment="center">
      {icon ? <Icon name={icon} size={20} color={color} modifiers={[frame({ width: 28, height: 28 })]} /> : null}
      <Text textStyle={{ color }}>{label}</Text>
    </Row>
  </Button>;
}

export function ValueRow({ label, value }: { label: string; value: string }) {
  return <LabeledContent label={label}><Text textStyle={{ color: Gallery.muted }}>{value}</Text></LabeledContent>;
}
