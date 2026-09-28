import { useRouter } from "expo-router";
import { type ReactNode, useRef, useState } from "react";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GalleryButton } from "@/components/collection/gallery-button";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing, Typography } from "@/constants/theme";
import { signInRoute } from "@/lib/account/sign-in-context";

import { AccessLines, PromptPreview, useWelcomeAccess, type AccessStep } from "./welcome-access";
import { WelcomeArt, welcomeWall } from "./welcome-art";

const BRAND_STATEMENT = "Remember the art that stays with you.";

export function WelcomeScreen() {
  const router = useRouter();
  const { top, bottom } = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const pager = useRef<Animated.ScrollView>(null);
  const scrollX = useSharedValue(0);
  const [index, setIndex] = useState(0);
  const access = useWelcomeAccess();
  // 0 while the welcome page is centered, 1 once it has been swiped away; drives the wall parallax.
  const welcomeProgress = useDerivedValue(() => (reduced ? 0 : scrollX.get() / width));
  const count = access.steps.length + 1;
  const last = index === count - 1;
  const step = index === 0 ? undefined : access.steps[index - 1];
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollX.set(event.contentOffset.x);
    },
  });
  const finish = () => router.back();
  const advance = () => {
    if (last) {
      finish();
      return;
    }
    pager.current?.scrollTo({ x: (index + 1) * width, animated: !reduced });
    setIndex(index + 1);
  };
  const allow = async (current: AccessStep) => {
    await access.answer(current);
    advance();
  };

  return (
    <View style={[styles.root, { paddingTop: top + Spacing.two, paddingBottom: Math.max(Spacing.four, bottom) }]}>
      <View style={styles.header}>
        <View accessible accessibilityLabel={`Page ${index + 1} of ${count}`} style={styles.progress}>
          {Array.from({ length: count }, (_, position) => (
            <ProgressSegment key={position} position={position} scrollX={scrollX} width={width} />
          ))}
        </View>
        <View
          pointerEvents={last ? "none" : "auto"}
          accessibilityElementsHidden={last}
          importantForAccessibility={last ? "no-hide-descendants" : "auto"}
          style={{ opacity: last ? 0 : 1 }}
        >
          <GalleryButton label="Skip" tone="ink" fullWidth={false} onPress={finish} />
        </View>
      </View>
      <Animated.ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={onScroll}
        onMomentumScrollEnd={(event) => setIndex(Math.round(event.nativeEvent.contentOffset.x / width))}
        style={styles.pager}
      >
        <WelcomePage active={index === 0} width={width}>
          <Stage color={welcomeWall} square>
            {(size) => <WelcomeArt size={size} progress={welcomeProgress} />}
          </Stage>
          <Headline accessibilityLabel={`Welcome to Artlog. ${BRAND_STATEMENT}`}>{BRAND_STATEMENT}</Headline>
        </WelcomePage>
        {access.steps.map((current, position) => (
          <WelcomePage key={current.key} active={index === position + 1} width={width}>
            <Stage color={current.wall}>
              {() => <PromptPreview prompt={current.prompt} stacked={current.prompt.options.length > 2} />}
            </Stage>
            <Headline>{current.headline}</Headline>
            <AccessLines lines={current.lines} />
          </WelcomePage>
        ))}
      </Animated.ScrollView>
      <View style={styles.actions}>
        {step ? (
          <>
            <GalleryButton
              label={step.answer === "unanswered" ? `Allow ${step.name}` : "Continue"}
              fullWidth
              variant="filled"
              busy={access.asking === step.key}
              busyLabel="Asking…"
              onPress={() => void allow(step)}
            />
            {step.answer === "unanswered" && (
              <GalleryButton label="Not now" fullWidth variant="filled" tone="neutral" onPress={advance} />
            )}
          </>
        ) : (
          <>
            <GalleryButton label="Get started" fullWidth variant="filled" onPress={advance} />
            <GalleryButton
              label="I already have an account"
              fullWidth
              variant="filled"
              tone="neutral"
              onPress={() => router.replace(signInRoute("account"))}
            />
          </>
        )}
      </View>
    </View>
  );
}

function WelcomePage({ active, width, children }: { active: boolean; width: number; children: ReactNode }) {
  return (
    <ScrollView
      style={{ width }}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      contentInsetAdjustmentBehavior="never"
      alwaysBounceVertical={false}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.page}
    >
      {children}
    </ScrollView>
  );
}

/** A tinted wall; `square` art is sized to the stage, a prompt preview sizes itself and centers. */
function Stage({
  color,
  square = false,
  children,
}: {
  color: string;
  square?: boolean;
  children: (size: number) => ReactNode;
}) {
  const { fontScale } = useWindowDimensions();
  const [layout, setLayout] = useState<{ width: number; height: number }>();
  return (
    <View
      onLayout={({ nativeEvent }) => setLayout(nativeEvent.layout)}
      style={[
        styles.stage,
        { backgroundColor: color },
        square ? { flex: 1, minHeight: fontScale > 1.3 ? 200 : 160 } : styles.prompt,
      ]}
    >
      {/* Absolute, so square art never props the stage open when the copy needs the room. */}
      {square ? (
        <View style={styles.art}>{layout && children(Math.min(layout.width, layout.height))}</View>
      ) : (
        children(0)
      )}
    </View>
  );
}

function Headline({ accessibilityLabel, children }: { accessibilityLabel?: string; children: string }) {
  const { fontScale } = useWindowDimensions();
  return (
    <Text
      accessibilityRole="header"
      accessibilityLabel={accessibilityLabel}
      style={fontScale > 1.3 ? Typography.display : styles.title}
    >
      {children}
    </Text>
  );
}

function ProgressSegment({
  position,
  scrollX,
  width,
}: {
  position: number;
  scrollX: SharedValue<number>;
  width: number;
}) {
  const fill = useAnimatedStyle(() => ({
    transform: [
      {
        scaleX: interpolate(scrollX.get() / width, [position - 1, position], [0, 1], Extrapolation.CLAMP),
      },
    ],
  }));
  return (
    <View style={styles.track}>
      <Animated.View style={[styles.fill, fill]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Gallery.paper },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingHorizontal: Spacing.content,
  },
  progress: { flex: 1, flexDirection: "row", gap: Spacing.one },
  track: { flex: 1, height: 3, borderRadius: Radius.full, overflow: "hidden", backgroundColor: Gallery.softBorder },
  fill: { flex: 1, backgroundColor: Gallery.ink, transformOrigin: "left" },
  pager: { flex: 1 },
  page: { flexGrow: 1, paddingHorizontal: Spacing.content, paddingTop: Spacing.two, gap: Spacing.four },
  stage: { overflow: "hidden", borderRadius: Radius.sheet },
  prompt: { minHeight: 300, padding: Spacing.three, alignItems: "center", justifyContent: "center" },
  art: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  title: { ...Typography.display, fontSize: 36, lineHeight: 47, color: Gallery.ink },
  actions: { gap: Spacing.compact, paddingHorizontal: Spacing.content, paddingTop: Spacing.three },
});
