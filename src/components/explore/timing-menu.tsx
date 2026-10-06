import { Host, Icon, Row, Text } from "@expo/ui";
import { font } from "@expo/ui/swift-ui/modifiers";
import { useWindowDimensions } from "react-native";

import { NativeChoiceMenu } from "@/components/choice-menu";
import { Fonts, Gallery } from "@/constants/theme";
import { TIMING_OPTIONS, timingLabel, type ExhibitionTiming } from "@/lib/explore/exhibition-timing";

/** The exhibitions row's heading is also its menu, so the choice reads as naming that row, not filtering the page. */
export function TimingMenuHeading({
  value,
  onChange,
}: {
  value: ExhibitionTiming;
  onChange: (value: ExhibitionTiming) => void;
}) {
  const { fontScale } = useWindowDimensions();
  return (
    <Host matchContents colorScheme="light">
      <NativeChoiceMenu label="Exhibitions" value={value} options={TIMING_OPTIONS} onChange={onChange}>
        <Row spacing={6} alignment="center">
          <Text
            textStyle={{ color: Gallery.ink }}
            modifiers={[font({ family: Fonts.display, size: 20, textStyle: "title3" })]}
          >
            {timingLabel(value)}
          </Text>
          <Icon name="chevron.up.chevron.down" size={14 * fontScale} color={Gallery.accent} />
        </Row>
      </NativeChoiceMenu>
    </Host>
  );
}
