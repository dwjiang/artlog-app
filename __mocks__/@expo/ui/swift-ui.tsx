import { Children, type ReactElement } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { PickerProps, DatePickerProps, ToggleProps } from '@expo/ui/swift-ui';
export { Text };
export function Label({ title }: { title?: string }) { return <Text>{title}</Text>; }
export const Host = View;
export const Menu = View;
export function Picker({ selection, onSelectionChange, children, modifiers }: PickerProps) {
  const disabled = modifiers?.some((modifier) => modifier.$type === 'disabled' && modifier.disabled === true);
  return <View>{Children.map(children, (child) => {
    const item = child as ReactElement<{ children: string; title?: string; modifiers?: { $type: string; tag?: string }[] }>;
    const value = item.props.modifiers?.find((modifier) => modifier.$type === 'tag')?.tag;
    return <Pressable accessibilityRole="button" accessibilityState={{ disabled, selected: selection === value }} disabled={disabled}
      onPress={() => onSelectionChange?.(value ?? null)}><Text>{item.props.title ?? item.props.children}</Text></Pressable>;
  })}</View>;
}
export function DatePicker({ title, selection, onDateChange }: DatePickerProps) {
  return <TextInput accessibilityLabel={title} value={selection?.toISOString()} onChangeText={(value) => onDateChange?.(new Date(value))} />;
}

export function Toggle({ isOn, onIsOnChange, modifiers, children }: ToggleProps) {
  const label = modifiers?.find((modifier) => modifier.$type === 'accessibilityLabel')?.label as string | undefined;
  const disabled = modifiers?.some((modifier) => modifier.$type === 'disabled' && modifier.disabled === true);
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: isOn, disabled }} disabled={disabled} onPress={() => onIsOnChange?.(!isOn)}>{children}</Pressable>;
}
