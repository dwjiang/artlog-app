import { Image, type ImageSource } from "expo-image";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import Animated, { cubicBezier, useReducedMotion } from "react-native-reanimated";

import { GalleryIconButton } from "@/components/collection/gallery-icon-button";
import { ArtworkCollage, introArtworks } from "@/components/guest/artwork-preview";
import { PaintingReveal } from "@/components/scan/painting-reveal";
import { ThemedText as Text } from "@/components/themed-text";
import { Fonts, Gallery, Radius, Spacing } from "@/constants/theme";
import type { FrameSize } from "@/lib/capture/rectangle";
import { liftedPlacement, perspectiveMatrix, photoCorners, type RevealGeometry } from "@/lib/capture/reveal-geometry";
import type { Quad } from "@/lib/capture/stages";

import type { AccessKey } from "./welcome-access";

const museum = {
  source: require("../../../assets/images/onboarding/museum-postcard.jpg"),
  width: 862,
  height: 680,
  // The Met's entrance, as fractions of the photograph.
  entrance: { x: 0.61, y: 0.48 },
};
// The Met's photograph of Washington Crossing the Delaware in its empty gallery, and its reproduction for the lifted
// painting: the photograph holds too few pixels of it to fill the screen.
const gallery = {
  photo: require("../../../assets/images/onboarding/washington-crossing-the-delaware-room.webp"),
  photoSize: { width: 1200, height: 1600 },
  // The canvas inside its frame, as fractions of the photograph.
  corners: [
    [0.28, 0.3371],
    [0.7159, 0.3371],
    [0.7159, 0.5271],
    [0.28, 0.5271],
  ] as Quad,
  crop: require("../../../assets/images/onboarding/washington-crossing-the-delaware.webp"),
  cropSize: { width: 1937, height: 1135 },
};
const STORY = "Leutze painted it in Germany, using American tourists and art students as models.";
const STORY_WORDS = STORY.split(" ");
const WORD_MS = 280;
// The welcome scan runs by itself, the way the camera's does: once the welcome has slid up and the room has been seen,
// the painting lifts out, and the result rises as the shine passes, with its story waiting for Play.
const SCAN_DELAY = 1400;
const RESULT_DELAY = 2500;

const DRIFT_SCALE = 1.1;
const DRIFT_SHIFT = 6;
const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);
// CSS ease-out: a lone fade on the strong curve lands almost at once and reads as a pop.
const FADE_EASE = cubicBezier(0, 0, 0.58, 1);

const MOTIONS = {
  rise: {
    from: { opacity: 0, transform: [{ translateY: 24 }] },
    to: { opacity: 1, transform: [{ translateY: 0 }] },
  },
  drop: {
    from: { opacity: 0, transform: [{ translateY: -24 }] },
    to: { opacity: 1, transform: [{ translateY: 0 }] },
  },
  pop: {
    from: { opacity: 0, transform: [{ scale: 0.9 }] },
    to: { opacity: 1, transform: [{ scale: 1 }] },
  },
  fade: { from: { opacity: 0 }, to: { opacity: 1 } },
};
type Motion = Exclude<keyof typeof MOTIONS, "fade">;

/** Plays once on mount; Reduce Motion keeps only the fade. `style` must not carry its own transform. */
function Enter({
  motion,
  delay,
  style,
  children,
}: {
  motion: Motion;
  delay: number;
  style?: ViewStyle;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  return (
    <Animated.View
      style={[
        style,
        {
          animationName: MOTIONS[reduced ? "fade" : motion],
          animationDuration: reduced ? 250 : 450,
          animationDelay: delay,
          animationTimingFunction: reduced ? FADE_EASE : EASE_OUT,
          animationFillMode: "backwards",
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * A painting filling its page above the sheet. It drifts slowly while its page is showing, the way a hand-held
 * camera would; `focus` is the cover crop's anchor, as fractions, and `children` drift with the paint.
 */
function Backdrop({
  source,
  focus,
  active,
  blurRadius,
  children,
}: {
  source: ImageSource;
  focus: { x: number; y: number };
  active: boolean;
  blurRadius?: number;
  children?: ReactNode;
}) {
  const reduced = useReducedMotion();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.backdrop}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          !reduced && {
            animationName: {
              from: { transform: [{ scale: 1.04 }] },
              to: { transform: [{ scale: DRIFT_SCALE }, { translateX: -DRIFT_SHIFT }, { translateY: 4 }] },
            },
            animationDuration: 14000,
            animationIterationCount: "infinite",
            animationDirection: "alternate",
            animationTimingFunction: "ease-in-out",
            animationPlayState: active ? "running" : "paused",
          },
        ]}
      >
        <Image
          source={source}
          contentFit="cover"
          contentPosition={{ left: `${focus.x * 100}%`, top: `${focus.y * 100}%` }}
          blurRadius={blurRadius}
          accessible={false}
          style={StyleSheet.absoluteFill}
        />
        {children}
      </Animated.View>
    </View>
  );
}

/**
 * The welcome's scan of Washington Crossing the Delaware, played with the camera's reveal. `clear` keeps the lifted painting between the
 * status bar and the result card.
 */
export function WelcomeArt({ clear }: { clear: { top: number; bottom: number } }) {
  const [box, setBox] = useState<FrameSize>();
  const [scanned, setScanned] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setScanned(true), SCAN_DELAY);
    return () => clearTimeout(timer);
  }, []);
  const { top, bottom } = clear;
  const geometry = useMemo(() => box && welcomeScanGeometry(box, { top, bottom }), [box, top, bottom]);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.camera}
      onLayout={({ nativeEvent }) => setBox(nativeEvent.layout)}
    >
      {geometry && (
        <PaintingReveal
          geometry={geometry}
          // Until the scan, the photograph shows its own painting; the brighter reproduction would look pasted on.
          crop={scanned ? gallery.crop : undefined}
          playing={scanned}
          background={(blurRadius) => (
            <Image
              source={gallery.photo}
              contentFit="cover"
              blurRadius={blurRadius}
              accessible={false}
              style={StyleSheet.absoluteFill}
            />
          )}
        />
      )}
    </View>
  );
}

function welcomeScanGeometry(box: FrameSize, clear: { top: number; bottom: number }): RevealGeometry | null {
  const from = photoCorners(gallery.corners, gallery.photoSize, box, "cover");
  const { to, width, height } = liftedPlacement(gallery.cropSize, box, clear);
  if (!perspectiveMatrix(width, height, from)) return null;
  return { from, to, width, height, image: { left: 0, top: 0, width, height } };
}

/** Reveals the story a word at a time once the visitor presses Play; until then every word waits in gray. */
function useStoryReveal() {
  const [said, setSaid] = useState(0);
  const [playing, setPlaying] = useState(false);
  const finished = said >= STORY_WORDS.length;
  useEffect(() => {
    if (!playing || finished) return;
    const timer = setTimeout(() => setSaid((count) => count + 1), WORD_MS);
    return () => clearTimeout(timer);
  }, [finished, playing, said]);
  const control = finished
    ? { label: "Replay story", icon: "arrow.counterclockwise" as const, onPress: () => setSaid(0) }
    : playing
      ? { label: "Pause story", icon: "pause.fill" as const, onPress: () => setPlaying(false) }
      : { label: "Play story", icon: "play.fill" as const, onPress: () => setPlaying(true) };
  return { said, control };
}

/** The welcome scan's result, risen out of the sheet: the painting it found and its story, read in captions. */
export function ScanResult() {
  const { said, control } = useStoryReveal();
  return (
    <Enter motion="rise" delay={RESULT_DELAY} style={styles.resultSlot}>
      <View style={[styles.card, styles.result]}>
        <View style={styles.resultRow}>
          <Image source={gallery.crop} contentFit="cover" accessible={false} style={styles.thumbnail} />
          <View accessible style={styles.resultText}>
            <Text style={styles.cardTitle}>Washington Crossing the Delaware</Text>
            <Text style={styles.cardDetail}>Emanuel Leutze · 1851</Text>
          </View>
          <View style={styles.storyControl}>
            <GalleryIconButton
              label={control.label}
              icon={control.icon}
              tone="surface"
              size={16}
              onPress={control.onPress}
            />
          </View>
        </View>
        <Text accessibilityLabel={STORY} style={styles.story}>
          {STORY_WORDS.map((word, position) => (
            <Text key={position} style={{ color: position < said ? Gallery.ink : Gallery.muted }}>
              {position === STORY_WORDS.length - 1 ? word : `${word} `}
            </Text>
          ))}
        </Text>
      </View>
    </Enter>
  );
}

/** What each permission page shows behind its sheet. `shown` turns on when the page first arrives. */
export function AccessArt({ step, active, shown }: { step: AccessKey; active: boolean; shown: boolean }) {
  if (step === "camera") {
    return <Backdrop source={introArtworks.pearl.source} focus={{ x: 0.5, y: 0.3 }} active={active} />;
  }
  if (step === "photos") {
    return <Backdrop source={introArtworks.lilies.source} focus={{ x: 0.5, y: 0.6 }} active={active} />;
  }
  return <MuseumArt active={active} shown={shown} />;
}

/** The saved original rising out of the Photos sheet with its check. */
export function SavedPhotoTile({ shown }: { shown: boolean }) {
  if (!shown) return null;
  return (
    <Enter motion="rise" delay={300} style={styles.tileSlot}>
      <View style={styles.tile}>
        <Image source={introArtworks.lilies.source} contentFit="cover" accessible={false} style={styles.fill} />
        <Enter motion="pop" delay={750} style={styles.check}>
          <Image source="sf:checkmark" tintColor={Gallery.surface} accessible={false} style={styles.checkIcon} />
        </Enter>
      </View>
    </Enter>
  );
}

const MUSEUM_FOCUS = { x: 0.6, y: 0.5 };
const PLACE_WIDTH = 300;

/** A 1914 photograph of the Met with its pin dropped on the entrance and the museum named above it. */
function MuseumArt({ active, shown }: { active: boolean; shown: boolean }) {
  const [box, setBox] = useState<{ width: number; height: number }>();
  // Mirrors the cover crop so the pin stays on the entrance at every screen size.
  const scale = box ? Math.max(box.width / museum.width, box.height / museum.height) : 0;
  const pin = box && {
    left: (box.width - museum.width * scale) * MUSEUM_FOCUS.x + museum.entrance.x * museum.width * scale,
    top: (box.height - museum.height * scale) * MUSEUM_FOCUS.y + museum.entrance.y * museum.height * scale,
  };
  // The name centers over the pin but stays inside the screen edges, even at the drift's widest zoom.
  const center = box ? box.width / 2 : 0;
  const leftEdge = center + (Spacing.compact + DRIFT_SHIFT - center) / DRIFT_SCALE;
  const rightEdge = box ? center + (box.width - Spacing.compact - center) / DRIFT_SCALE : 0;
  const placeLeft = pin
    ? Math.min(Math.max(-PLACE_WIDTH / 2, leftEdge - pin.left), rightEdge - pin.left - PLACE_WIDTH)
    : 0;
  return (
    <View style={styles.fill} onLayout={({ nativeEvent }) => setBox(nativeEvent.layout)}>
      <Backdrop source={museum.source} focus={MUSEUM_FOCUS} active={active}>
        {shown && pin && (
          <View style={[styles.pinAnchor, pin]}>
            <Enter motion="drop" delay={300} style={styles.pin}>
              <Image source="sf:building.columns.fill" tintColor={Gallery.surface} style={styles.pinIcon} />
            </Enter>
            <Enter motion="pop" delay={650} style={{ ...styles.place, left: placeLeft }}>
              <View style={[styles.card, styles.placeCard]}>
                <Text numberOfLines={1} style={styles.placeName}>
                  The Metropolitan Museum of Art
                </Text>
                <Text numberOfLines={1} style={styles.cardDetail}>
                  Fifth Avenue, New York
                </Text>
              </View>
            </Enter>
          </View>
        )}
      </Backdrop>
    </View>
  );
}

/** The sign-in page: the collection an account keeps, as prints on a wall. */
export function SignInArt() {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.collection}>
      <ArtworkCollage />
    </View>
  );
}

/** The name page's soft wash of Water Lilies, so the sheet leads. */
export function NameArt({ active }: { active: boolean }) {
  return (
    <Backdrop source={introArtworks.lilies.source} focus={{ x: 0.5, y: 0.5 }} active={active} blurRadius={24}>
      <View style={styles.wash} />
    </Backdrop>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFill, overflow: "hidden", backgroundColor: Gallery.ink },
  wash: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(255,255,255,0.22)" },
  collection: { ...StyleSheet.absoluteFill, justifyContent: "center", backgroundColor: Gallery.sage },
  camera: { ...StyleSheet.absoluteFill, overflow: "hidden", backgroundColor: Gallery.ink },
  card: {
    borderRadius: Radius.card,
    backgroundColor: Gallery.surface,
    boxShadow: "0 16px 32px -12px rgba(8,11,16,0.55), 0 1px 3px rgba(8,11,16,0.18)",
  },
  resultSlot: { marginHorizontal: Spacing.three, marginBottom: Spacing.compact },
  result: { padding: Spacing.compact, gap: 10 },
  resultRow: { flexDirection: "row", alignItems: "center", gap: Spacing.compact },
  resultText: { flex: 1, gap: 2 },
  thumbnail: { width: 56, height: 56, borderRadius: Radius.thumbnail },
  storyControl: { width: 44, height: 44, borderRadius: 22, backgroundColor: Gallery.accent },
  cardTitle: { fontFamily: Fonts.display, fontSize: 19, lineHeight: 24, letterSpacing: -0.3, color: Gallery.ink },
  cardDetail: { fontSize: 14, lineHeight: 20, color: Gallery.muted },
  story: { fontSize: 15, lineHeight: 21 },
  tileSlot: { position: "absolute", right: Spacing.content, bottom: -28 },
  tile: {
    width: 90,
    height: 90,
    padding: 3,
    borderRadius: 5,
    backgroundColor: Gallery.surface,
    boxShadow: "0 14px 26px -10px rgba(8,11,16,0.5), 0 1px 3px rgba(8,11,16,0.2)",
  },
  check: {
    position: "absolute",
    right: -8,
    bottom: -8,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2.5,
    borderColor: Gallery.surface,
    backgroundColor: Gallery.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  checkIcon: { width: 11, height: 11 },
  pinAnchor: { position: "absolute", width: 0, height: 0 },
  pin: {
    position: "absolute",
    left: -22,
    bottom: 6,
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 3,
    borderColor: Gallery.surface,
    backgroundColor: Gallery.accent,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 6px 14px -4px rgba(0,0,0,0.5)",
  },
  pinIcon: { width: 18, height: 18 },
  place: { position: "absolute", bottom: 62, width: PLACE_WIDTH },
  placeCard: { paddingHorizontal: 14, paddingVertical: 10, alignItems: "center" },
  placeName: { fontSize: 16, lineHeight: 21, fontWeight: "600", color: Gallery.ink },
});
