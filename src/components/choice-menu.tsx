import { Host, Icon, Row, Text as NativeText } from "@expo/ui";
import { Menu, Section, Toggle } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  background,
  buttonStyle,
  contentShape,
  disabled as disabledModifier,
  font,
  frame,
  padding,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import type { ComponentProps } from "react";
import { useWindowDimensions } from "react-native";

import { Gallery, Radius, Spacing } from "@/constants/theme";

/**
 * A chip that opens a native menu; `label` titles the menu and names the chip for VoiceOver. The highlight tone marks
 * a status the chip changes rather than a filter it applies.
 */
export function ChoiceMenu<T extends string>({
  label,
  value,
  options,
  onChange,
  icon,
  tone = "track",
  disabled = false,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  icon?: ComponentProps<typeof Icon>["name"];
  tone?: "track" | "highlight";
  disabled?: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  const selected = options.find((option) => option.value === value)?.label;
  const highlight = tone === "highlight";
  return (
    <Host matchContents colorScheme="light">
      <Menu
        modifiers={[accessibilityLabel(`${label}: ${selected}`), buttonStyle("plain"), disabledModifier(disabled)]}
        label={
          <Row
            spacing={Spacing.one + Spacing.half}
            alignment="center"
            modifiers={[
              padding({ horizontal: Spacing.compact + Spacing.half, vertical: Spacing.two }),
              background(
                highlight ? Gallery.highlight : Gallery.segmentTrack,
                highlight ? shapes.roundedRectangle({ cornerRadius: Radius.input }) : shapes.capsule(),
              ),
              // The chip stays compact while the whole 44-point row answers taps.
              frame({ minHeight: 44 }),
              contentShape(shapes.rectangle()),
            ]}
          >
            {icon && <Icon name={icon} size={13 * fontScale} color={Gallery.ink} />}
            <NativeText
              textStyle={{ color: Gallery.ink }}
              modifiers={[font({ textStyle: "subheadline", weight: highlight ? "semibold" : "medium" })]}
            >
              {selected}
            </NativeText>
            <Icon name="chevron.down" size={10 * fontScale} color={Gallery.ink} />
          </Row>
        }
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
    </Host>
  );
}
