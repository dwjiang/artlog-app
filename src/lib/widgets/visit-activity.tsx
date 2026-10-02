import { HStack, Image, Text, VStack } from "@expo/ui/swift-ui";
import { font, foregroundStyle, padding } from "@expo/ui/swift-ui/modifiers";
import { createLiveActivity, type LiveActivityEnvironment } from "expo-widgets";

export type VisitActivityProps = {
  venueName: string;
  count: number;
  /** "1:42 PM", formatted by the app in the museum's time zone; the widget runtime has no clock of its own. */
  since: string;
};

/** The visit in progress on the Lock Screen and in the Dynamic Island; tapping it opens the camera. */
function VisitActivityLayout(props: VisitActivityProps, environment: LiveActivityEnvironment) {
  "widget";
  // The widget runtime sees nothing outside this function, so the palette lives here.
  const accent = "#254FD4";
  const dark = environment.colorScheme === "dark" || environment.isLuminanceReduced === true;
  const ink = dark ? "#FFFFFF" : "#1B2531";
  const muted = dark ? "#B0B4BA" : "#66717C";
  const artworks = `${props.count} ${props.count === 1 ? "artwork" : "artworks"}`;
  return {
    banner: (
      <HStack spacing={12} modifiers={[padding({ all: 16 })]}>
        <Image systemName="building.columns.fill" color={accent} />
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ weight: "semibold", size: 16 }), foregroundStyle(ink)]}>
            Visiting {props.venueName}
          </Text>
          <Text modifiers={[font({ size: 13 }), foregroundStyle(muted)]}>
            {artworks} · Since {props.since}
          </Text>
        </VStack>
      </HStack>
    ),
    compactLeading: <Image systemName="building.columns.fill" color={accent} />,
    compactTrailing: (
      <Text modifiers={[font({ weight: "semibold", size: 14 }), foregroundStyle(ink)]}>{props.count}</Text>
    ),
    minimal: <Image systemName="building.columns.fill" color={accent} />,
    expandedLeading: (
      <HStack spacing={8} modifiers={[padding({ all: 12 })]}>
        <Image systemName="building.columns.fill" color={accent} />
        <Text modifiers={[font({ weight: "semibold", size: 15 }), foregroundStyle(ink)]}>{props.venueName}</Text>
      </HStack>
    ),
    expandedTrailing: (
      <VStack alignment="trailing" modifiers={[padding({ all: 12 })]}>
        <Text modifiers={[font({ weight: "semibold", size: 20 }), foregroundStyle(ink)]}>{props.count}</Text>
        <Text modifiers={[font({ size: 12 }), foregroundStyle(muted)]}>
          {props.count === 1 ? "artwork" : "artworks"}
        </Text>
      </VStack>
    ),
    expandedBottom: (
      <Text modifiers={[font({ size: 13 }), foregroundStyle(muted), padding({ horizontal: 12, bottom: 8 })]}>
        Since {props.since} · Tap to scan the next artwork
      </Text>
    ),
  };
}

export const VisitActivity = createLiveActivity("VisitActivity", VisitActivityLayout);
