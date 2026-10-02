import { Image } from "expo-image";
import { useState, type ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import Animated, { cubicBezier, useReducedMotion } from "react-native-reanimated";

import { WallFrame } from "@/components/collection/wall-frame";
import { ArtworkCollage, introArtworks } from "@/components/guest/artwork-preview";
import { ThemedText as Text } from "@/components/themed-text";
import { Fonts, Gallery, Radius, Spacing } from "@/constants/theme";

import type { AccessKey } from "./welcome-access";

const lilies = { ...introArtworks.lilies, name: "Water Lilies", detail: "Claude Monet · 1906" };
const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);
// CSS ease-out: a lone fade on the strong curve lands almost at once and reads as a pop.
const FADE_EASE = cubicBezier(0, 0, 0.58, 1);
const MAX_SCALE = 1.15;

const MOTIONS = {
  rise: {
    from: { opacity: 0, transform: [{ translateY: 16 }] },
    to: { opacity: 1, transform: [{ translateY: 0 }] },
  },
  drop: {
    from: { opacity: 0, transform: [{ translateY: -12 }] },
    to: { opacity: 1, transform: [{ translateY: 0 }] },
  },
  pop: {
    from: { opacity: 0, transform: [{ scale: 0.95 }] },
    to: { opacity: 1, transform: [{ scale: 1 }] },
  },
  settle: {
    from: { opacity: 0, transform: [{ scale: 1.08 }] },
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
          animationDuration: reduced ? 250 : 300,
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

/** Draws a fixed-size picture scaled into the room its page leaves. */
function Fitted({ width, height, children }: { width: number; height: number; children: ReactNode }) {
  const [box, setBox] = useState<{ width: number; height: number }>();
  const scale = box ? Math.min(MAX_SCALE, box.width / width, box.height / height) : 0;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={({ nativeEvent }) => setBox(nativeEvent.layout)}
      style={styles.fill}
    >
      {box && (
        <View
          style={{
            position: "absolute",
            left: (box.width - width) / 2,
            top: (box.height - height) / 2,
            width,
            height,
            transform: [{ scale }],
          }}
        >
          {children}
        </View>
      )}
    </View>
  );
}

/** Postcards with the narration player under them: the story half of the welcome title. */
export function WelcomeArt() {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.welcome}>
      <Enter motion="rise" delay={200}>
        <ArtworkCollage />
      </Enter>
      <Enter motion="rise" delay={550} style={styles.playerSlot}>
        <View style={styles.player}>
          <Image source={lilies.source} contentFit="cover" accessible={false} style={styles.playerThumbnail} />
          <View style={styles.playerText}>
            <Text allowFontScaling={false} numberOfLines={1} style={styles.playerTitle}>
              {lilies.name}
            </Text>
            <Text allowFontScaling={false} numberOfLines={1} style={styles.playerSubtitle}>
              Playing · 2:14 left
            </Text>
          </View>
          <Image source="sf:pause.fill" tintColor={Gallery.accent} accessible={false} style={styles.playerIcon} />
          <Image source="sf:list.bullet" tintColor={Gallery.ink} accessible={false} style={styles.playerIcon} />
        </View>
      </Enter>
    </View>
  );
}

/** What each permission produces. `shown` turns on when its page first arrives and plays the entrance then. */
export function AccessArt({ step, shown }: { step: AccessKey; shown: boolean }) {
  if (step === "camera") return <ScanArt shown={shown} />;
  if (step === "photos") return <PhotosArt shown={shown} />;
  return <VisitArt shown={shown} />;
}

function ScanArt({ shown }: { shown: boolean }) {
  return (
    <Fitted width={300} height={384}>
      <View style={styles.viewfinder}>
        <View style={styles.viewfinderArt}>
          <WallFrame frame="walnut" width={170}>
            <Image
              source={lilies.source}
              contentFit="cover"
              accessible={false}
              style={{ width: "100%", aspectRatio: lilies.aspectRatio }}
            />
          </WallFrame>
        </View>
        {shown && (
          <Enter motion="settle" delay={250} style={styles.reticle}>
            <View style={[styles.corner, styles.topLeft]} />
            <View style={[styles.corner, styles.topRight]} />
            <View style={[styles.corner, styles.bottomLeft]} />
            <View style={[styles.corner, styles.bottomRight]} />
          </Enter>
        )}
      </View>
      {shown && (
        <Enter motion="rise" delay={550} style={styles.result}>
          <View style={[styles.card, styles.resultCard]}>
            <Image source={lilies.source} contentFit="cover" accessible={false} style={styles.thumbnail} />
            <View style={styles.playerText}>
              <Text allowFontScaling={false} style={styles.cardTitle}>
                {lilies.name}
              </Text>
              <Text allowFontScaling={false} style={styles.cardDetail}>
                {lilies.detail}
              </Text>
            </View>
          </View>
        </Enter>
      )}
    </Fitted>
  );
}

// Muted stand-ins for the rest of someone's library; only the saved artwork is a real image.
const LIBRARY_TONES = ["#D9D4CA", "#BFC8CF", "#CDD0CA", "#A9B4BE", "#E2DCD0", "#C3BBAE", "#B7C2B3", "#D3D8DE"];
const LIBRARY_ARTWORKS: Partial<Record<number, (typeof introArtworks)[keyof typeof introArtworks]>> = {
  4: introArtworks.stars,
  8: introArtworks.pearl,
};
const TILE = (300 - 2 * 2) / 3;

function PhotosArt({ shown }: { shown: boolean }) {
  return (
    <Fitted width={300} height={354}>
      <View style={[styles.card, styles.library]}>
        <Text allowFontScaling={false} style={styles.libraryTitle}>
          Recents
        </Text>
        <View style={styles.grid}>
          {Array.from({ length: 9 }, (_, position) => {
            const artwork = LIBRARY_ARTWORKS[position];
            if (position === 0) {
              return (
                <View key={position} style={[styles.tile, { backgroundColor: Gallery.fill }]}>
                  {shown && (
                    <Enter motion="pop" delay={250} style={StyleSheet.absoluteFill}>
                      <Image source={lilies.source} contentFit="cover" accessible={false} style={styles.fill} />
                      <View style={styles.added} />
                      <Enter motion="pop" delay={450} style={styles.badge}>
                        <Image source="sf:checkmark" tintColor={Gallery.surface} style={styles.badgeIcon} />
                      </Enter>
                    </Enter>
                  )}
                </View>
              );
            }
            return artwork ? (
              <Image key={position} source={artwork.source} contentFit="cover" accessible={false} style={styles.tile} />
            ) : (
              <View
                key={position}
                style={[styles.tile, { backgroundColor: LIBRARY_TONES[position % LIBRARY_TONES.length] }]}
              />
            );
          })}
        </View>
      </View>
    </Fitted>
  );
}

const MAP = { land: "#ECEEE8", park: "#CFE0C3", water: "#B9D3E6", road: Gallery.surface, here: "#2F7CF6" };

function VisitArt({ shown }: { shown: boolean }) {
  return (
    <Fitted width={300} height={344}>
      <View style={[styles.card, styles.visit]}>
        <View style={styles.map}>
          <View style={[styles.mapArea, { left: 132, top: 38, width: 78, height: 114, backgroundColor: MAP.park }]} />
          <View style={[styles.mapArea, { left: 240, top: 0, width: 60, height: 190, backgroundColor: MAP.water }]} />
          {[34, 104, 156].map((top) => (
            <View key={top} style={[styles.mapArea, { left: 0, top, width: 300, height: 7 }]} />
          ))}
          {[48, 126, 210].map((left) => (
            <View key={left} style={[styles.mapArea, { left, top: 0, width: 7, height: 190 }]} />
          ))}
          <View style={styles.here} />
          {shown && (
            <Enter motion="drop" delay={250} style={styles.pin}>
              <View style={styles.pinDot}>
                <Image source="sf:building.columns.fill" tintColor={Gallery.surface} style={styles.pinIcon} />
              </View>
            </Enter>
          )}
        </View>
        <View style={styles.visitBody}>
          <Text allowFontScaling={false} style={[styles.cardTitle, styles.visitTitle]}>
            Art Institute of Chicago
          </Text>
          <Text allowFontScaling={false} style={styles.cardDetail}>
            Chicago · Today
          </Text>
          <View style={styles.visitWorks}>
            <View style={styles.thumbnail}>
              {shown && (
                <Enter motion="pop" delay={450} style={StyleSheet.absoluteFill}>
                  <Image source={lilies.source} contentFit="cover" accessible={false} style={styles.fill} />
                </Enter>
              )}
            </View>
            <View style={styles.thumbnail} />
            <View style={styles.thumbnail} />
          </View>
        </View>
      </View>
    </Fitted>
  );
}

const CORNER = 34;
const styles = StyleSheet.create({
  fill: { flex: 1 },
  welcome: { alignItems: "center" },
  playerSlot: { width: "90%", maxWidth: 320, marginTop: -Spacing.three },
  player: {
    height: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 14,
    paddingRight: Spacing.three,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Gallery.separator,
    backgroundColor: Gallery.surface,
    boxShadow: "0 12px 28px -12px rgba(27,37,49,0.35)",
  },
  playerThumbnail: { width: 32, height: 32, borderRadius: Radius.thumbnail },
  playerText: { flex: 1, gap: 2 },
  playerTitle: { fontSize: 14, lineHeight: 18, fontWeight: "600", color: Gallery.ink },
  playerSubtitle: { fontSize: 11, lineHeight: 14, color: Gallery.muted },
  playerIcon: { width: 20, height: 20, marginLeft: Spacing.two },
  viewfinder: { width: 300, height: 360, borderRadius: Radius.sheet, overflow: "hidden", backgroundColor: "#46525F" },
  viewfinderArt: { position: "absolute", left: 65, top: 56 },
  reticle: { position: "absolute", left: 44, top: 36, width: 212, height: 212 },
  corner: { position: "absolute", width: CORNER, height: CORNER, borderColor: Gallery.surface },
  topLeft: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 14 },
  topRight: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 14 },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 14 },
  bottomRight: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 14 },
  card: {
    borderRadius: Radius.card,
    backgroundColor: Gallery.surface,
    boxShadow: "0 14px 30px -12px rgba(27,37,49,0.3), 0 1px 3px rgba(27,37,49,0.1)",
  },
  result: { position: "absolute", left: 20, top: 302, width: 260 },
  resultCard: { flexDirection: "row", alignItems: "center", gap: Spacing.compact, padding: Spacing.compact },
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: Radius.thumbnail,
    overflow: "hidden",
    backgroundColor: Gallery.fill,
  },
  cardTitle: { fontFamily: Fonts.display, fontSize: 19, lineHeight: 24, letterSpacing: -0.3, color: Gallery.ink },
  cardDetail: { fontSize: 14, lineHeight: 20, color: Gallery.muted },
  library: { width: 300, overflow: "hidden" },
  libraryTitle: { padding: Spacing.three, paddingBottom: Spacing.compact, fontSize: 20, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 2 },
  tile: { width: TILE, height: TILE },
  added: { ...StyleSheet.absoluteFill, borderWidth: 3, borderColor: Gallery.accent },
  badge: {
    position: "absolute",
    right: 6,
    bottom: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Gallery.surface,
    backgroundColor: Gallery.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeIcon: { width: 10, height: 10 },
  visit: { width: 300, overflow: "hidden" },
  map: { height: 190, backgroundColor: MAP.land },
  mapArea: { position: "absolute", backgroundColor: MAP.road },
  here: {
    position: "absolute",
    left: 70,
    top: 124,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
    borderColor: Gallery.surface,
    backgroundColor: MAP.here,
    boxShadow: "0 0 0 10px rgba(47,124,246,0.18)",
  },
  pin: { position: "absolute", left: 150, top: 60 },
  pinDot: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: Gallery.surface,
    backgroundColor: Gallery.accent,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 3px 8px rgba(0,0,0,0.25)",
  },
  pinIcon: { width: 18, height: 18 },
  visitBody: { padding: Spacing.three, gap: Spacing.one },
  visitTitle: { fontSize: 22, lineHeight: 28 },
  visitWorks: { flexDirection: "row", gap: 6, marginTop: Spacing.two },
});
