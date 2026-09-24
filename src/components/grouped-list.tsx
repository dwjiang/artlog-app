import { Button, Column, Host, Icon, ListItem, Row, Text } from "@expo/ui";
import { LabeledContent, List, Rectangle, Section, Spacer } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  accessibilityValue,
  background,
  buttonStyle,
  contentShape,
  font,
  foregroundStyle,
  frame,
  listRowBackground,
  listRowInsets,
  listRowSeparator,
  listStyle,
  multilineTextAlignment,
  padding,
  scrollContentBackground,
  shapes,
  strokeBorder,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { Children, Fragment, isValidElement, type ComponentProps, type ReactNode } from "react";
import { Gallery, SettingsOutline, Spacing } from "@/constants/theme";
import { NativeLoadingRing } from "./native-loading-ring";

type IconName = ComponentProps<typeof Icon>["name"];

/** Render as a screen root: the native list needs the available screen frame. */
export function GroupedList({ children }: { children: ReactNode }) {
  // Inset-grouped lists clip custom card outlines to the system corner radius.
  return (
    <Host style={{ flex: 1 }} colorScheme="light" seedColor={Gallery.accent}>
      <List
        modifiers={[
          listStyle("grouped"),
          padding({ horizontal: Spacing.content }),
          scrollContentBackground("hidden"),
          background(Gallery.paper),
          foregroundStyle(Gallery.ink),
          tint(Gallery.accent),
        ]}
      >
        {children}
      </List>
    </Host>
  );
}

export function GroupedSection({
  children,
  modifiers = [],
  destructive = false,
  ...props
}: ComponentProps<typeof Section> & { destructive?: boolean }) {
  return (
    <Section {...props} modifiers={[listRowBackground("clear"), ...modifiers]}>
      <Column
        spacing={0}
        modifiers={[
          listRowInsets({ top: 0, bottom: 0, leading: 0, trailing: 0 }),
          listRowSeparator("hidden"),
          background(
            destructive ? Gallery.destructiveFill : Gallery.surface,
            shapes.roundedRectangle({
              cornerRadius: SettingsOutline.borderRadius,
            }),
          ),
          strokeBorder({
            color: SettingsOutline.borderColor,
            style: { lineWidth: SettingsOutline.borderWidth },
            shape: "roundedRectangle",
            cornerRadius: SettingsOutline.borderRadius,
          }),
        ]}
      >
        {Children.toArray(children)
          .filter(isValidElement)
          .map((child, index) => (
            <Fragment key={child.key}>
              {index > 0 && (
                <Rectangle
                  modifiers={[
                    foregroundStyle(SettingsOutline.borderColor),
                    frame({ height: SettingsOutline.borderWidth }),
                    padding({ horizontal: Spacing.compact }),
                  ]}
                />
              )}
              <Row
                modifiers={[
                  padding({
                    horizontal: Spacing.three,
                    vertical: Spacing.compact,
                  }),
                  frame({
                    maxWidth: Infinity,
                    minHeight: 44,
                    alignment: "leading",
                  }),
                ]}
              >
                {child}
              </Row>
            </Fragment>
          ))}
      </Column>
    </Section>
  );
}

export function GroupedFooter({ children, tone = "muted" }: { children: string; tone?: "muted" | "destructive" }) {
  return (
    <Text
      modifiers={[font({ textStyle: "footnote" })]}
      textStyle={{
        color: tone === "destructive" ? Gallery.destructive : Gallery.muted,
      }}
    >
      {children}
    </Text>
  );
}

export function NavigationRow({
  label,
  detail,
  value,
  onPress,
  loading = false,
}: {
  label: string;
  detail?: string;
  value?: string;
  onPress: () => void;
  loading?: boolean;
}) {
  return (
    <ListItem
      trailing={
        <Row spacing={8} alignment="center">
          {loading ? (
            <NativeLoadingRing label={`Loading ${label.toLowerCase()}`} />
          ) : value ? (
            <Text modifiers={[font({ textStyle: "subheadline" })]} textStyle={{ color: Gallery.muted }}>
              {value}
            </Text>
          ) : null}
          <Icon name="chevron.right" size={13} color={Gallery.muted} />
        </Row>
      }
      modifiers={[
        accessibilityLabel(label),
        accessibilityValue(loading ? "Loading" : (value ?? "")),
        font({ textStyle: "body" }),
        frame({ minHeight: 44 }),
      ]}
      supportingText={
        detail ? (
          <Text modifiers={[font({ textStyle: "footnote" })]} textStyle={{ color: Gallery.muted }}>
            {detail}
          </Text>
        ) : undefined
      }
      onPress={onPress}
    >
      {label}
    </ListItem>
  );
}

export function ActionRow({
  label,
  icon,
  onPress,
  disabled = false,
  destructive = false,
  busy = false,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
  busy?: boolean;
}) {
  const color = destructive ? Gallery.destructive : Gallery.accent;
  // The spacer lets SwiftUI measure a spinner inserted into an initially idle slot.
  const indicator = (
    <Row alignment="center" modifiers={[frame({ width: 28, height: 28 })]}>
      {busy ? (
        <NativeLoadingRing label={`${label} in progress`} color={color} />
      ) : icon ? (
        <Icon name={icon} size={20} color={color} />
      ) : (
        <Spacer />
      )}
    </Row>
  );
  return (
    <Button
      variant="text"
      disabled={disabled || busy}
      onPress={onPress}
      modifiers={[
        accessibilityLabel(label),
        accessibilityValue(busy ? "In progress" : ""),
        buttonStyle("borderless"),
        tint(color),
        frame({ minHeight: 44 }),
      ]}
    >
      <Row
        spacing={12}
        alignment="center"
        modifiers={[frame({ maxWidth: Infinity, alignment: "leading" }), contentShape(shapes.rectangle())]}
      >
        {icon && indicator}
        <Text modifiers={[font({ textStyle: "body" }), multilineTextAlignment("leading")]} textStyle={{ color }}>
          {label}
        </Text>
        {!icon && indicator}
      </Row>
    </Button>
  );
}

export function ValueRow({ label, value, loading = false }: { label: string; value?: string; loading?: boolean }) {
  return (
    <LabeledContent label={label} modifiers={[font({ textStyle: "body" })]}>
      {loading ? (
        <NativeLoadingRing label={`Loading ${label.toLowerCase()}`} />
      ) : (
        <Text modifiers={[font({ textStyle: "body" })]} textStyle={{ color: Gallery.muted }}>
          {value}
        </Text>
      )}
    </LabeledContent>
  );
}
