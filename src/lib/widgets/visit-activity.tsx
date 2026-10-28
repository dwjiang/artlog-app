import { Circle, HStack, Image, Rectangle, Spacer, Text, VStack, ZStack } from "@expo/ui/swift-ui";
import {
  accessibilityElement,
  accessibilityHidden,
  accessibilityLabel,
  activityBackgroundTint,
  background,
  clipShape,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  opacity,
  padding,
  resizable,
} from "@expo/ui/swift-ui/modifiers";
import { createLiveActivity } from "expo-widgets";

export type VisitActivityProps = {
  venueName: string;
  count: number;
  /** "1:42 PM", formatted by the app in the museum's time zone; the widget runtime has no clock of its own. */
  since: string;
  /** Up to three square photo files from the visit, newest first, in the directory the widget extension can read. */
  thumbnails: string[];
};

/** The visit in progress on the Lock Screen and in the Dynamic Island; tapping it opens the camera. */
function VisitActivityLayout(props: VisitActivityProps) {
  "widget";
  // The widget runtime sees nothing outside this function, so the palette lives here. iOS 26 derives the Lock Screen
  // banner's default background and reported color scheme from the wallpaper, and renders a tint as see-through glass,
  // so the banner paints opaque paper itself. The Dynamic Island is always black.
  const accent = "#254FD4";
  const paper = "#FFFFFF";
  const ink = "#1B2531";
  const muted = "#66717C";
  const islandInk = "#FFFFFF";
  const islandMuted = "#B0B4BA";
  const islandAccent = "#7A9AF6";
  const display = "SpaceGrotesk-SemiBold";
  // An activity started by an older build keeps its props until the app next updates it.
  const thumbnails = props.thumbnails ?? [];
  const meta =
    props.count === 0
      ? `Since ${props.since}`
      : `Since ${props.since} · ${props.count} ${props.count === 1 ? "artwork" : "artworks"}`;
  const strip = (size: number) => (
    <HStack spacing={4} modifiers={[accessibilityHidden(true)]}>
      {thumbnails.map((uri, index) => {
        // The last thumbnail also stands for the saves without one on show.
        const more = index === thumbnails.length - 1 && props.count > thumbnails.length ? props.count - index : 0;
        return (
          <ZStack key={uri} modifiers={[frame({ width: size, height: size }), clipShape("roundedRectangle", 2)]}>
            <Image uiImage={uri} modifiers={[resizable(), frame({ width: size, height: size })]} />
            {more > 0 && <Rectangle modifiers={[foregroundStyle(ink), opacity(0.58)]} />}
            {more > 0 && (
              <Text modifiers={[font({ weight: "semibold", size: 14 }), foregroundStyle("#FFFFFF")]}>{`+${more}`}</Text>
            )}
          </ZStack>
        );
      })}
    </HStack>
  );
  const camera = (
    <ZStack modifiers={[frame({ width: 38, height: 38 }), accessibilityHidden(true)]}>
      <Circle modifiers={[foregroundStyle(accent)]} />
      <Image systemName="camera.fill" size={16} color="#FFFFFF" />
    </ZStack>
  );
  const mark =
    thumbnails.length > 0 ? (
      <Image
        uiImage={thumbnails[0]}
        modifiers={[resizable(), frame({ width: 22, height: 22 }), clipShape("roundedRectangle", 5)]}
      />
    ) : (
      <Image systemName="building.columns.fill" color={islandAccent} />
    );
  return {
    banner: (
      <HStack
        spacing={12}
        modifiers={[
          padding({ vertical: 14, horizontal: 16 }),
          background(paper),
          activityBackgroundTint(paper),
          accessibilityElement("combine"),
        ]}
      >
        <VStack alignment="leading" spacing={1}>
          <Text modifiers={[font({ family: display, size: 17 }), foregroundStyle(ink), lineLimit(2)]}>
            {props.venueName}
          </Text>
          <Text modifiers={[font({ size: 13 }), foregroundStyle(muted), lineLimit(1)]}>{meta}</Text>
        </VStack>
        <Spacer />
        {thumbnails.length > 0 ? strip(44) : camera}
      </HStack>
    ),
    compactLeading: mark,
    compactTrailing:
      props.count > 0 ? (
        <Text
          modifiers={[
            font({ weight: "semibold", size: 14 }),
            foregroundStyle(islandInk),
            accessibilityLabel(`${props.count} ${props.count === 1 ? "artwork" : "artworks"}`),
          ]}
        >
          {props.count}
        </Text>
      ) : (
        <Image systemName="camera.fill" color={islandAccent} />
      ),
    minimal: mark,
    expandedLeading: (
      <VStack
        alignment="leading"
        spacing={1}
        modifiers={[padding({ leading: 8, top: 4 }), accessibilityElement("combine")]}
      >
        <Text modifiers={[font({ family: display, size: 17 }), foregroundStyle(islandInk), lineLimit(1)]}>
          {props.venueName}
        </Text>
        <Text modifiers={[font({ size: 13 }), foregroundStyle(islandMuted), lineLimit(1)]}>{meta}</Text>
      </VStack>
    ),
    expandedTrailing: (
      <HStack modifiers={[padding({ trailing: 8, top: 4 })]}>{thumbnails.length > 0 ? strip(40) : camera}</HStack>
    ),
  };
}

export const VisitActivity = createLiveActivity("VisitActivity", VisitActivityLayout);
