import { Host } from "@expo/ui";
import { DatePicker } from "@expo/ui/swift-ui";
import { datePickerStyle, disabled, labelsHidden, tint } from "@expo/ui/swift-ui/modifiers";

import { Gallery } from "@/constants/theme";
import { dateFromPicker, pickerDate } from "@/lib/journal/visit-date";

/** A visit's calendar day on the native compact picker; `latest` is today at the museum. */
export function VisitDatePicker({
  value,
  latest,
  onChange,
  showLabel = true,
  disabled: isDisabled = false,
}: {
  value: string;
  latest: string;
  onChange: (value: string) => void;
  showLabel?: boolean;
  disabled?: boolean;
}) {
  return (
    <Host matchContents={showLabel ? { vertical: true } : true} colorScheme="light">
      <DatePicker
        title="Visit date"
        selection={pickerDate(value)}
        range={{ end: pickerDate(latest) }}
        displayedComponents={["date"]}
        onDateChange={(date) => onChange(dateFromPicker(date))}
        modifiers={[
          datePickerStyle("compact"),
          tint(Gallery.accent),
          ...(showLabel ? [] : [labelsHidden()]),
          ...(isDisabled ? [disabled(true)] : []),
        ]}
      />
    </Host>
  );
}
