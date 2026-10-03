import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Image, type ImageSource } from "expo-image";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View, useWindowDimensions, type ViewStyle } from "react-native";
import Animated, { cubicBezier } from "react-native-reanimated";

import { GalleryIconButton } from "@/components/collection/gallery-icon-button";
import { ArtworkCollage, introArtworks } from "@/components/guest/artwork-preview";
import { PaintingReveal } from "@/components/scan/painting-reveal";
import { ThemedText as Text } from "@/components/themed-text";
import { Fonts, Gallery, Motion, Radius, Spacing } from "@/constants/theme";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { configureSpokenAudio } from "@/lib/audio/spoken-audio-mode";
import type { FrameSize } from "@/lib/capture/rectangle";
import { liftedPlacement, perspectiveMatrix, photoCorners, type RevealGeometry } from "@/lib/capture/reveal-geometry";
import type { Quad } from "@/lib/capture/stages";
import { reportError } from "@/lib/observability";

import type { AccessKey } from "./welcome-access";

const EASE_OUT = cubicBezier(...Motion.easeOut);

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
const STORY =
  "Leutze painted it in Germany, using American tourists and art students as models. The American painter Worthington Whittredge posed as Washington. Look at the flag: the Stars and Stripes it carries wasn’t adopted until the summer after this crossing.";
const STORY_WORDS = STORY.split(" ");
// Each sentence of the story, as word positions.
const SENTENCE_STARTS = STORY_WORDS.flatMap((_, position) =>
  position === 0 || /[.!?]$/.test(STORY_WORDS[position - 1]) ? [position] : [],
);
const SENTENCES = SENTENCE_STARTS.map((from, index) => ({
  from,
  to: SENTENCE_STARTS[index + 1] ?? STORY_WORDS.length,
}));
// Below this screen height, in text-size points, the whole story leaves the lifted painting too little room.
const SUBTITLE_HEIGHT = 720;
// The story in the narration voice, and where each word starts in it, in seconds, from a word-level transcription.
const narration = {
  source: require("../../../assets/audio/welcome-story.m4a"),
  wordStarts: [
    0, 1.06, 1.56, 1.74, 2.14, 2.92, 3.16, 3.8, 4.38, 4.8, 5.08, 5.38, 5.74, 6.82, 6.96, 7.36, 7.78, 8.48, 9.28, 9.74,
    10.08, 11.62, 11.7, 11.82, 12.34, 12.88, 13.08, 13.34, 13.72, 13.92, 14.6, 14.6, 15.26, 15.66, 15.96, 16.44, 16.44,
    16.88, 17.18,
  ],
};
// The welcome scan runs by itself, the way the camera's does: once the welcome has slid up and the room has been seen,
// the painting lifts out, and the result rises as the shine passes, with its story waiting for Play.
const SCAN_DELAY = 1400;
const RESULT_DELAY = 2500;

const DRIFT_SCALE = 1.1;
const DRIFT_SHIFT = 6;

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
type EnterMotion = Exclude<keyof typeof MOTIONS, "fade">;

/** Plays once on mount; Reduce Motion keeps only the fade. `style` must not carry its own transform. */
function Enter({
  motion,
  delay,
  style,
  children,
}: {
  motion: EnterMotion;
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
          animationDuration: Motion.enter,
          animationDelay: delay,
          animationTimingFunction: EASE_OUT,
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

/**
 * Reads the story aloud once the visitor presses Play, lighting each word as it is spoken; until then every word waits
 * in gray. Leaving the page pauses it.
 */
function useStoryReveal(active: boolean) {
  const player = useAudioPlayer(narration.source, { updateInterval: 50 });
  const { playing, currentTime, duration } = useAudioPlayerStatus(player);
  const generation = useRef(0);
  const cancelPendingPlay = useCallback(() => {
    generation.current++;
  }, []);
  // Strictly past a word's start, so the first word stays gray until the voice moves and again after a rewind.
  const said = narration.wordStarts.filter((start) => start < currentTime).length;
  const finished = !playing && duration > 0 && currentTime >= duration;
  useEffect(() => {
    if (!active) player.pause();
    return cancelPendingPlay;
  }, [active, player, cancelPendingPlay]);
  const play = async () => {
    if (!active) return;
    const request = ++generation.current;
    try {
      try {
        await configureSpokenAudio();
      } catch (cause) {
        if (request === generation.current) reportError(cause, "account.welcome.story");
      }
      if (request !== generation.current) return;
      if (finished) {
        await player.seekTo(0);
        if (request !== generation.current) return;
      }
      player.play();
    } catch (cause) {
      if (request === generation.current) reportError(cause, "account.welcome.story");
    }
  };
  const control = finished
    ? { label: "Replay story", icon: "arrow.counterclockwise" as const, onPress: () => void play() }
    : playing
      ? { label: "Pause story", icon: "pause.fill" as const, onPress: () => player.pause() }
      : { label: "Play story", icon: "play.fill" as const, onPress: () => void play() };
  return { said, control };
}

function StoryWords({ from, to, said }: { from: number; to: number; said: number }) {
  return STORY_WORDS.slice(from, to).map((word, offset) => {
    const position = from + offset;
    return (
      <Text key={position} style={{ color: position < said ? Gallery.ink : Gallery.muted }}>
        {position === to - 1 ? word : `${word} `}
      </Text>
    );
  });
}

/**
 * The story a sentence at a time, for short screens: the one being spoken shows in place of the rest. The sentences
 * share one spot, so the card is as tall as the longest and keeps its height as they turn.
 */
function StorySubtitles({ said }: { said: number }) {
  const reduced = useReducedMotion();
  const shown = SENTENCE_STARTS.filter((start) => start < Math.max(said, 1)).length - 1;
  return (
    <View accessible accessibilityLabel={STORY} style={styles.subtitles}>
      {SENTENCES.map(({ from, to }, index) => (
        <Animated.View
          key={from}
          style={[
            styles.subtitle,
            index > 0 && styles.stackedSubtitle,
            { opacity: index === shown ? 1 : 0 },
            {
              transitionProperty: "opacity",
              transitionDuration: reduced ? 0 : Motion.state,
              transitionTimingFunction: EASE_OUT,
            },
          ]}
        >
          <Text style={styles.story}>
            <StoryWords from={from} to={to} said={said} />
          </Text>
        </Animated.View>
      ))}
    </View>
  );
}

/** The welcome scan's result, risen out of the sheet: the painting it found and its story, read aloud in captions. */
export function ScanResult({ active }: { active: boolean }) {
  const { said, control } = useStoryReveal(active);
  const { height, fontScale } = useWindowDimensions();
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
        {height / fontScale < SUBTITLE_HEIGHT ? (
          <StorySubtitles said={said} />
        ) : (
          <Text accessibilityLabel={STORY} style={styles.story}>
            <StoryWords from={0} to={STORY_WORDS.length} said={said} />
          </Text>
        )}
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
  subtitles: { flexDirection: "row" },
  subtitle: { width: "100%" },
  // Pulls every later sentence back onto the first; the row still grows to the tallest.
  stackedSubtitle: { marginLeft: "-100%" },
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
