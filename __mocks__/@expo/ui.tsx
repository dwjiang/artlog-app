import type { ComponentProps, ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

export const Host = View;
export const RNHostView = View;
export function ListItem({ children, onPress, supportingText }: { children: ReactNode; onPress?: () => void; supportingText?: ReactNode }) {
  return <Pressable accessibilityRole="button" onPress={onPress}><Text>{children}</Text>{supportingText && <Text>{supportingText}</Text>}</Pressable>;
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
  return <Pressable accessibilityRole="button" accessibilityLabel={modifiers?.find((modifier) => modifier.$type === 'accessibilityLabel')?.label as string | undefined}
    accessibilityState={{ disabled: !!disabled, selected: traits?.includes('isSelected') }} disabled={disabled} onPress={onPress}>{children ?? <Text>{label}</Text>}</Pressable>;
}
export function BottomSheet({ isPresented, children }: { isPresented: boolean; children: ReactNode }) {
  return isPresented ? <View>{children}</View> : null;
}
