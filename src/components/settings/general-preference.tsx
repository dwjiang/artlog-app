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
import { reportError } from "@/lib/observability";
import { setMeasurementUnits, type MeasurementUnits } from "@/lib/settings/measurement-units";
import { useMeasurementUnits } from "@/lib/settings/use-measurement-units";
import { showErrorToast } from "@/lib/ui/toast";

const options = [
  { value: "metric", label: "Metric", detail: "Meters and kilometers" },
  { value: "imperial", label: "Imperial", detail: "Feet and miles" },
] as const;

export function GeneralPreference() {
  const { units: saved, failed } = useMeasurementUnits();
  const [choice, setChoice] = useState<MeasurementUnits>();
  const pending = useRef(false);
  const units = choice ?? saved;
  const loading = units === undefined && !failed;

  // The local write lands within a frame or two, so a saving state would only flash; show the choice at once.
  async function change(value: MeasurementUnits) {
    if (pending.current) return;
    pending.current = true;
    setChoice(value);
    try {
      await setMeasurementUnits(value);
    } catch (cause) {
      reportError(cause, "settings.measurement-units.save");
      showErrorToast("Couldn’t save measurement units.", () => void change(value));
    } finally {
      pending.current = false;
      setChoice(undefined);
    }
  }

  const message = failed ? "The preference could not load. Choose your units to try again." : undefined;
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
            // A borderless button hugs its label, so both it and its row stretch to put the checkmark at the trailing edge.
            modifiers={[
              buttonStyle("borderless"),
              accessibilityLabel(option.label),
              accessibilityAddTraits(units === option.value ? ["isSelected"] : []),
              frame({ maxWidth: Infinity }),
            ]}
          >
            <Row
              spacing={12}
              alignment="center"
              modifiers={[frame({ maxWidth: Infinity }), contentShape(shapes.rectangle())]}
            >
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
