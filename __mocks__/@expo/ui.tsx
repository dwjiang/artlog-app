import type { ComponentProps, ReactNode } from 'react';
import { Pressable, Text, TextInput as RNTextInput, View } from 'react-native';

export const Host = View;
export const RNHostView = View;
export function ListItem({ children, onPress, supportingText, modifiers }: ComponentProps<typeof import('@expo/ui').ListItem>) {
  const off = !!modifiers?.some((modifier) => modifier.$type === 'disabled' && modifier.disabled === true);
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: off }} disabled={off} onPress={onPress}>
    <Text>{children}</Text>{supportingText && <Text>{supportingText}</Text>}</Pressable>;
}
export function Switch({ label, value, onValueChange, disabled }: ComponentProps<typeof import('@expo/ui').Switch>) {
  return <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value, disabled: !!disabled }}
    disabled={disabled} onPress={() => onValueChange(!value)}><Text>{label}</Text></Pressable>;
}
export const Row = View;
export const Column = View;
export { Text };
export function Icon() { return null; }
export function Button({ label, children, onPress, disabled, modifiers }: ComponentProps<typeof import('@expo/ui').Button>) {
  const traits = modifiers?.find((modifier) => modifier.$type === 'accessibilityAddTraits')?.traits as string[] | undefined;
  const off = !!disabled || !!modifiers?.some((modifier) => modifier.$type === 'disabled' && modifier.disabled === true);
  return <Pressable accessibilityRole="button" accessibilityLabel={modifiers?.find((modifier) => modifier.$type === 'accessibilityLabel')?.label as string | undefined}
    accessibilityState={{ disabled: off, selected: traits?.includes('isSelected') }} disabled={off} onPress={onPress}>{children ?? <Text>{label}</Text>}</Pressable>;
}
export function TextInput({ modifiers, placeholder, defaultValue, onChangeText, autoCapitalize, autoCorrect, maxLength, editable, multiline, numberOfLines }: ComponentProps<typeof import('@expo/ui').TextInput>) {
  return <RNTextInput placeholder={placeholder} defaultValue={defaultValue} onChangeText={onChangeText} autoCapitalize={autoCapitalize} autoCorrect={autoCorrect}
    maxLength={maxLength} editable={editable} multiline={multiline} numberOfLines={numberOfLines}
    accessibilityLabel={modifiers?.find((modifier) => modifier.$type === 'accessibilityLabel')?.label as string | undefined} />;
}
export function BottomSheet({ isPresented, children }: { isPresented: boolean; children: ReactNode }) {
  return isPresented ? <View>{children}</View> : null;
}
