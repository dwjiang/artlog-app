import type { ComponentProps, ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

export const Host = View;
export const RNHostView = View;
export function ListItem({ children, onPress }: { children: ReactNode; onPress?: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress}><Text>{children}</Text></Pressable>;
}
export function Switch({ label, value, onValueChange, disabled }: ComponentProps<typeof import('@expo/ui').Switch>) {
  return <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value, disabled: !!disabled }}
    disabled={disabled} onPress={() => onValueChange(!value)}><Text>{label}</Text></Pressable>;
}
export function Button({ label, onPress, disabled }: ComponentProps<typeof import('@expo/ui').Button>) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}><Text>{label}</Text></Pressable>;
}
export function BottomSheet({ isPresented, children }: { isPresented: boolean; children: ReactNode }) {
  return isPresented ? <View>{children}</View> : null;
}
