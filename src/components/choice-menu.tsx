import { Host, Menu, Picker, Section, Text, Toggle } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  buttonStyle,
  disabled as disabledModifier,
  frame,
  pickerStyle,
  tag,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { ReactNode } from "react";

import { Gallery } from "@/constants/theme";

/** The system pop-up button, showing the selected option; `label` names it for VoiceOver. */
export function ChoiceMenu<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <Host matchContents colorScheme="light">
      <Picker
        label={label}
        selection={value}
        onSelectionChange={onChange}
        modifiers={[pickerStyle("menu"), tint(Gallery.accent), disabledModifier(disabled), frame({ minHeight: 44 })]}
      >
        {options.map((option) => (
          <Text key={option.value} modifiers={[tag(option.value)]}>
            {option.label}
          </Text>
        ))}
      </Picker>
    </Host>
  );
}

/** A native selection menu whose trigger is supplied by its enclosing SwiftUI layout. */
export function NativeChoiceMenu<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  children,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const selected = options.find((option) => option.value === value)?.label;
  return (
    <Menu
      modifiers={[accessibilityLabel(`${label}: ${selected}`), buttonStyle("plain"), disabledModifier(disabled)]}
      label={children}
    >
      {/* An inline Picker hides the section title inside a menu; controlled toggles keep it and still draw checkmarks. */}
      <Section title={label}>
        {options.map((option) => (
          <Toggle
            key={option.value}
            label={option.label}
            isOn={option.value === value}
            modifiers={[disabledModifier(disabled)]}
            onIsOnChange={() => onChange(option.value)}
          />
        ))}
      </Section>
    </Menu>
  );
}
