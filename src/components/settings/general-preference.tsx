import { Button, Column, Icon, Row, Text } from "@expo/ui";
import {
  accessibilityAddTraits,
  accessibilityLabel,
  buttonStyle,
  contentShape,
  font,
  frame,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import { useRef, useState } from "react";

import { GroupedFooter, GroupedSection, ValueRow } from "@/components/grouped-list";
import { Gallery } from "@/constants/theme";
import { setMeasurementUnits, type MeasurementUnits } from "@/lib/settings/measurement-units";
import { useMeasurementUnits } from "@/lib/settings/use-measurement-units";

const options = [
  { value: "metric", label: "Metric", detail: "Meters and kilometers" },
  { value: "imperial", label: "Imperial", detail: "Feet and miles" },
] as const;

export function GeneralPreference() {
  const { units: saved, failed } = useMeasurementUnits();
  const [choice, setChoice] = useState<MeasurementUnits>();
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  const units = choice ?? saved;
  const loading = units === undefined && !failed;

  // The local write lands within a frame or two, so a saving state would only flash; show the choice at once.
  async function change(value: MeasurementUnits) {
    if (pending.current || value === units) return;
    pending.current = true;
    setChoice(value);
    setError(undefined);
    try {
      await setMeasurementUnits(value);
    } catch {
      setError("The preference could not be saved. Try again.");
    } finally {
      pending.current = false;
      setChoice(undefined);
    }
  }

  const message = error ?? (failed ? "The preference could not load. Choose your units to try again." : undefined);
  return (
    <GroupedSection
      title="Measurement units"
      footer={
        <GroupedFooter tone={message ? "destructive" : "muted"}>
          {message ?? "Used for nearby museum distances. Saved on this iPhone."}
        </GroupedFooter>
      }
    >
      {loading ? (
        <ValueRow label="Measurement units" loading />
      ) : (
        options.map((option) => (
          <Button
            key={option.value}
            variant="text"
            onPress={() => {
              void change(option.value);
            }}
            modifiers={[
              buttonStyle("borderless"),
              accessibilityLabel(option.label),
              accessibilityAddTraits(units === option.value ? ["isSelected"] : []),
            ]}
          >
            <Row spacing={12} alignment="center" modifiers={[contentShape(shapes.rectangle())]}>
              <Column spacing={2} alignment="start" modifiers={[frame({ maxWidth: Infinity, alignment: "leading" })]}>
                <Text textStyle={{ color: Gallery.ink }} modifiers={[font({ textStyle: "body" })]}>
                  {option.label}
                </Text>
                <Text textStyle={{ color: Gallery.muted }} modifiers={[font({ textStyle: "footnote" })]}>
                  {option.detail}
                </Text>
              </Column>
              <Row modifiers={[frame({ width: 20 })]}>
                {units === option.value && <Icon name="checkmark" size={18} color={Gallery.accent} />}
              </Row>
            </Row>
          </Button>
        ))
      )}
    </GroupedSection>
  );
}
