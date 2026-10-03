import { Button, Column, Host, Icon, Row, Text } from "@expo/ui";
import { Spacer } from "@expo/ui/swift-ui";
import {
  accessibilityHint,
  accessibilityLabel,
  buttonStyle,
  contentShape,
  font,
  frame,
  shapes,
  textSelection,
} from "@expo/ui/swift-ui/modifiers";
import * as Sentry from "@sentry/react-native";
import { useEffect, useState } from "react";
import { AppState, useWindowDimensions } from "react-native";

import { NativeChoiceMenu } from "@/components/choice-menu";
import { GroupedCard } from "@/components/grouped-list";
import { Gallery, Spacing } from "@/constants/theme";
import type { VisitSummary } from "@/lib/journal/visit-summaries";
import type { VisitVisibility } from "@/shared/journal/contracts";
import { calendarDate } from "@/shared/journal/limits";

import { VisitDateField } from "./visit-date-picker";
import { VISIT_VISIBILITY } from "./visit-visibility-picker";

export function VisitDetailsFields({
  visit,
  visibility,
  disabled,
  visibilityDisabled,
  onMuseum,
  onDate,
  onVisibility,
}: {
  visit: VisitSummary;
  visibility: VisitVisibility;
  disabled: boolean;
  visibilityDisabled: boolean;
  onMuseum: () => void;
  onDate: (value: string) => void;
  onVisibility: (value: VisitVisibility) => void;
}) {
  const { fontScale } = useWindowDimensions();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function refresh() {
      clearTimeout(timer);
      const current = Date.now();
      setNow(current);
      // Align to minute boundaries so the museum's midnight is not delayed by mount time.
      timer = setTimeout(refresh, 60_000 - (current % 60_000));
    }
    refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
      else clearTimeout(timer);
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, []);
  const stacked = fontScale > 1.4;
  const FieldLayout = stacked ? Column : Row;
  const symbol = (name: "building.columns" | "calendar" | (typeof VISIT_VISIBILITY)[VisitVisibility]["icon"]) => (
    <Icon name={name} size={20 * fontScale} color={Gallery.muted} modifiers={[frame({ width: 26 * fontScale })]} />
  );
  const row = [frame({ minHeight: 44, maxWidth: Infinity, alignment: "leading" }), contentShape(shapes.rectangle())];
  return (
    <Sentry.Mask>
      <Host matchContents={{ vertical: true }} ignoreSafeArea="all" colorScheme="light">
        <GroupedCard outlined={false}>
          <Button
            onPress={onMuseum}
            disabled={disabled}
            modifiers={[
              accessibilityLabel(visit.venueName),
              accessibilityHint("Changes the museum"),
              buttonStyle("plain"),
            ]}
          >
            <Row spacing={Spacing.compact} alignment="center" modifiers={row}>
              {symbol("building.columns")}
              <Column alignment="start" spacing={3}>
                <Text textStyle={{ color: Gallery.ink }} modifiers={[font({ textStyle: "body", weight: "semibold" })]}>
                  {visit.venueName}
                </Text>
                {visit.location ? (
                  <Text
                    textStyle={{ color: Gallery.muted }}
                    modifiers={[font({ textStyle: "footnote" }), textSelection(true)]}
                  >
                    {visit.location}
                  </Text>
                ) : null}
              </Column>
              <Spacer />
              <Icon name="chevron.right" size={13 * fontScale} color={Gallery.muted} />
            </Row>
          </Button>
          <FieldLayout spacing={Spacing.compact} alignment={stacked ? "start" : "center"} modifiers={row}>
            <Row spacing={Spacing.compact} alignment="center">
              {symbol("calendar")}
              <Text textStyle={{ color: Gallery.ink }} modifiers={[font({ textStyle: "body" })]}>
                Date
              </Text>
            </Row>
            {!stacked && <Spacer />}
            <VisitDateField
              value={visit.visitedOn}
              latest={calendarDate(now, visit.timeZone)}
              showLabel={false}
              disabled={disabled}
              onChange={onDate}
            />
          </FieldLayout>
          <NativeChoiceMenu
            label="Visibility"
            value={visibility}
            disabled={visibilityDisabled}
            onChange={onVisibility}
            options={(Object.keys(VISIT_VISIBILITY) as VisitVisibility[]).map((value) => ({
              value,
              label: VISIT_VISIBILITY[value].label,
            }))}
          >
            <FieldLayout spacing={Spacing.compact} alignment={stacked ? "start" : "center"} modifiers={row}>
              <Row spacing={Spacing.compact} alignment="center">
                {symbol(VISIT_VISIBILITY[visibility].icon)}
                <Text textStyle={{ color: Gallery.ink }} modifiers={[font({ textStyle: "body" })]}>
                  Visibility
                </Text>
              </Row>
              {!stacked && <Spacer />}
              <Row spacing={Spacing.compact} alignment="center">
                <Text textStyle={{ color: Gallery.muted }} modifiers={[font({ textStyle: "body" })]}>
                  {VISIT_VISIBILITY[visibility].label}
                </Text>
                <Icon name="chevron.up.chevron.down" size={12 * fontScale} color={Gallery.muted} />
              </Row>
            </FieldLayout>
          </NativeChoiceMenu>
        </GroupedCard>
      </Host>
    </Sentry.Mask>
  );
}
