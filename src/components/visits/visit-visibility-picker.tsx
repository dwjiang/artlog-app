import { View } from "react-native";

import { ChoiceMenu } from "@/components/choice-menu";
import { NativeSegmentedPicker } from "@/components/collection/native-segmented-picker";
import { ThemedText as Text } from "@/components/themed-text";
import type { VisitVisibility } from "@/shared/journal/contracts";

import { visitStyles } from "./visit-ui";

export const VISIT_VISIBILITY = {
  private: { label: "Private", icon: "lock" },
  friends: { label: "Friends", icon: "person.2" },
  public: { label: "Public", icon: "globe" },
} as const;

const CHOICES = ["private", "friends", "public"] as const;
const LABEL = "Visibility";

/** Chooses who can see a visit and its shared version, as a form row. */
export function VisitVisibilityPicker({
  value,
  onChange,
  disabled,
  note,
}: {
  value: VisitVisibility;
  onChange: (value: VisitVisibility) => void;
  disabled?: boolean;
  note?: string;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={visitStyles.eyebrow}>Visibility</Text>
      <NativeSegmentedPicker
        label={LABEL}
        value={value}
        onChange={onChange}
        disabled={disabled}
        options={CHOICES.map((choice) => ({
          value: choice,
          label: VISIT_VISIBILITY[choice].label,
          icon: VISIT_VISIBILITY[choice].icon,
        }))}
      />
      {note && <Text style={visitStyles.fine}>{note}</Text>}
    </View>
  );
}

export type VisitAudienceFilterValue = VisitVisibility | "all";

/** Narrows a list of visits to one visibility, offering only the visibilities the viewer can see. */
export function VisitAudienceFilter({
  value,
  choices,
  onChange,
}: {
  value: VisitAudienceFilterValue;
  choices: readonly VisitVisibility[];
  onChange: (value: VisitAudienceFilterValue) => void;
}) {
  return (
    <ChoiceMenu
      label={LABEL}
      value={value}
      onChange={onChange}
      options={[
        { value: "all", label: "All Visits" },
        ...CHOICES.filter((choice) => choices.includes(choice)).map((choice) => ({
          value: choice,
          label: VISIT_VISIBILITY[choice].label,
        })),
      ]}
    />
  );
}
