import type { ButtonProps, PickerProps, DatePickerProps, SectionProps, ToggleProps } from "@expo/ui/swift-ui";
import { Children, useEffect, useRef, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

export { Text };
export function Label({ title }: { title?: string }) {
  return <Text>{title}</Text>;
}
// Presented sheet content lives outside the host's native view, so the host's `pointerEvents` must not block presses on it.
export function Host({ pointerEvents: _pointerEvents, ...props }: ComponentProps<typeof View>) {
  return <View {...props} />;
}
export const Menu = View;
export const List = View;
export const VStack = View;
export const HStack = View;
export const ZStack = View;
export const Spacer = View;
export const Rectangle = View;
export function ProgressView() {
  return <ActivityIndicator accessibilityRole="progressbar" />;
}
export const ScrollView = View;
export const RNHostView = View;
export const Group = View;
export function BottomSheet({
  isPresented,
  children,
  onDismiss,
}: {
  isPresented: boolean;
  children: ReactNode;
  onDismiss?: () => void;
}) {
  const wasPresented = useRef(isPresented);
  // The native sheet reports full dismissal after its animation; here it follows the prop change directly.
  useEffect(() => {
    if (wasPresented.current && !isPresented) onDismiss?.();
    wasPresented.current = isPresented;
  }, [isPresented, onDismiss]);
  return isPresented ? <View>{children}</View> : null;
}
export function Section({ title, header, children, footer }: SectionProps) {
  return (
    <View>
      {title ? <Text accessibilityRole="header">{title}</Text> : header}
      {children}
      {footer}
    </View>
  );
}
export function LabeledContent({ label, children }: { label?: ReactNode; children: ReactNode }) {
  return (
    <View>
      {typeof label === "string" ? <Text>{label}</Text> : label}
      {children}
    </View>
  );
}
export function Button({ label, children, onPress, role, modifiers }: ButtonProps) {
  const disabled = !!modifiers?.some((modifier) => modifier.$type === "disabled" && modifier.disabled === true);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        modifiers?.find((modifier) => modifier.$type === "accessibilityLabel")?.label as string | undefined
      }
      accessibilityState={{ disabled }}
      accessibilityHint={role}
      disabled={disabled}
      onPress={onPress}
    >
      {children ?? <Text>{label}</Text>}
    </Pressable>
  );
}
export function Picker({ selection, onSelectionChange, children, modifiers }: PickerProps) {
  const disabled = modifiers?.some((modifier) => modifier.$type === "disabled" && modifier.disabled === true);
  return (
    <View>
      {Children.map(children, (child) => {
        const item = child as ReactElement<{
          children: string;
          title?: string;
          modifiers?: { $type: string; tag?: string }[];
        }>;
        const value = item.props.modifiers?.find((modifier) => modifier.$type === "tag")?.tag;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled, selected: selection === value }}
            disabled={disabled}
            onPress={() => onSelectionChange?.(value ?? null)}
          >
            <Text>{item.props.title ?? item.props.children}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
export function DatePicker({ title, selection, onDateChange }: DatePickerProps) {
  return (
    <TextInput
      accessibilityLabel={title}
      value={selection?.toISOString()}
      onChangeText={(value) => onDateChange?.(new Date(value))}
    />
  );
}

export function Toggle({ isOn, onIsOnChange, modifiers, children }: ToggleProps) {
  const label = modifiers?.find((modifier) => modifier.$type === "accessibilityLabel")?.label as string | undefined;
  const disabled = modifiers?.some((modifier) => modifier.$type === "disabled" && modifier.disabled === true);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: isOn, disabled }}
      disabled={disabled}
      onPress={() => onIsOnChange?.(!isOn)}
    >
      {children}
    </Pressable>
  );
}
