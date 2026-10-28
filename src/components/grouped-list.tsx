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
  listSectionSpacing,
  listStyle,
  multilineTextAlignment,
  padding,
  scrollContentBackground,
  shapes,
  strokeBorder,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import * as Sentry from "@sentry/react-native";
import { Children, Fragment, isValidElement, type ComponentProps, type ReactNode } from "react";

import { Gallery, Radius, SettingsOutline, Spacing } from "@/constants/theme";

import { NativeLoadingRing } from "./native-loading-ring";

type IconName = ComponentProps<typeof Icon>["name"];

/** Render as a screen root: the native list needs the available screen frame. */
export function GroupedList({ children }: { children: ReactNode }) {
  // Inset-grouped lists clip custom card outlines to the system corner radius.
  return (
    <Sentry.Mask style={{ flex: 1 }}>
      <Host style={{ flex: 1 }} colorScheme="light" seedColor={Gallery.accent}>
        <List
          modifiers={[
            listStyle("grouped"),
            listSectionSpacing(Spacing.four),
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
    </Sentry.Mask>
  );
}

export function GroupedSection({ children, modifiers = [], ...props }: ComponentProps<typeof Section>) {
  return (
    <Section {...props} modifiers={[listRowBackground("clear"), ...modifiers]}>
      <GroupedCard>{children}</GroupedCard>
    </Section>
  );
}

/** Native grouped rows, also usable inside a Host in a mixed-content scroll view. */
export function GroupedCard({ children, outlined = true }: { children: ReactNode; outlined?: boolean }) {
  return (
    <Column
      spacing={0}
      modifiers={[
        listRowInsets({ top: 0, bottom: 0, leading: 0, trailing: 0 }),
        listRowSeparator("hidden"),
        background(
          Gallery.surface,
          shapes.roundedRectangle({
            cornerRadius: outlined ? SettingsOutline.borderRadius : Radius.sheet,
          }),
        ),
        ...(outlined
          ? [
              strokeBorder({
                color: SettingsOutline.borderColor,
                style: { lineWidth: SettingsOutline.borderWidth },
                shape: "roundedRectangle",
                cornerRadius: SettingsOutline.borderRadius,
              }),
            ]
          : []),
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
                  vertical: outlined ? Spacing.compact : Spacing.one + Spacing.half,
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
  busy = false,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const color = Gallery.accent;
  // The spacer lets SwiftUI measure a spinner inserted into an initially idle slot.
  const indicator = (
    <Row spacing={0} alignment="center" modifiers={[frame({ width: 28, height: 28 })]}>
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

/** Full-width ListButtons stacked as in ActionStack, with text actions flush beneath them, inside the native list. */
export function GroupedButtons({
  children,
  textActions,
  footer,
}: {
  children: ReactNode;
  textActions?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Section footer={footer} modifiers={[listRowBackground("clear")]}>
      <Column
        spacing={0}
        modifiers={[listRowInsets({ top: 0, bottom: 0, leading: 0, trailing: 0 }), listRowSeparator("hidden")]}
      >
        <Column spacing={Spacing.two}>{children}</Column>
        {textActions}
      </Column>
    </Section>
  );
}

/** A full-width GalleryButton for native lists, where React Native views cannot be list rows. */
export function ListButton({
  label,
  onPress,
  variant = "outlined",
  disabled = false,
  destructive = false,
  busy = false,
}: {
  label: string;
  onPress: () => void;
  variant?: "filled" | "outlined" | "text";
  disabled?: boolean;
  destructive?: boolean;
  busy?: boolean;
}) {
  const filled = variant === "filled";
  const tone = destructive ? Gallery.destructive : Gallery.accent;
  const color = filled ? Gallery.surface : tone;
  const surface = {
    filled: [background(tone, shapes.roundedRectangle({ cornerRadius: Radius.button }))],
    outlined: [
      strokeBorder({
        color: destructive ? Gallery.destructive : Gallery.accentBorder,
        style: { lineWidth: 1 },
        shape: "roundedRectangle",
        cornerRadius: Radius.button,
      }),
    ],
    text: [],
  }[variant];
  return (
    <Button
      variant="text"
      disabled={disabled || busy}
      onPress={onPress}
      modifiers={[
        accessibilityLabel(label),
        accessibilityValue(busy ? "In progress" : ""),
        buttonStyle("plain"),
        tint(color),
      ]}
    >
      <Row
        spacing={Spacing.two}
        alignment="center"
        modifiers={[
          frame({ maxWidth: Infinity, minHeight: filled ? 52 : 44 }),
          padding({ horizontal: Spacing.compact }),
          contentShape(shapes.rectangle()),
          ...surface,
        ]}
      >
        {busy && <NativeLoadingRing label={`${label} in progress`} color={color} />}
        <Text modifiers={[font({ textStyle: "body", weight: filled ? "semibold" : "regular" })]} textStyle={{ color }}>
          {label}
        </Text>
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
