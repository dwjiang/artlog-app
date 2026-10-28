import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { StatusBar } from "expo-status-bar";
import { createContext, use } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { GlassSurface } from "@/components/glass-surface";
import { ThemedText as Text } from "@/components/themed-text";
import { Colors, Gallery, OnPhoto, Radius, Spacing } from "@/constants/theme";
import { useReduceTransparency } from "@/hooks/use-reduce-transparency";
import { useLocalOwner } from "@/lib/account/owner-store";
import { formatVisitStart } from "@/lib/journal/history";
import { useVisitWorks } from "@/lib/journal/use-visit-works";
import { useHorizontalSafeAreaPadding } from "@/lib/ui/safe-area";
import { useCurrentMuseumPhoto } from "@/lib/venue/use-museum-photo";
import { useStartVisit } from "@/lib/venue/use-start-visit";
import { useVenue } from "@/lib/venue/use-venue";
import type { CurrentVisit } from "@/lib/venue/venue-reducer";

import { SafeAreaBand } from "../../../modules/safe-area-band/src";
import { newestPhoto, VisitBackdrop } from "./visit-backdrop";

/**
 * Set by the tab layout. Tab screens' own safe areas grow by the band, so the band reads the window's top inset from
 * outside them; it hides with the tab bar.
 */
export const VisitBandLayout = createContext<{ windowTop: number; tabBarHidden: boolean }>({
  windowTop: 0,
  tabBarHidden: false,
});

/**
 * The open visit across the top of a tab, under the status bar. Render it after the tab's stack: it pushes the tab's
 * header and content down by its height. Tapping it opens the visit. `onCamera` leaves out the band's own Scan button
 * and lets the blurred camera show through the visit photo. `beforeVisit` also shows it at a museum before the visit,
 * with Start visit where End will be.
 */
export function VisitBand({ onCamera = false, beforeVisit = false }: { onCamera?: boolean; beforeVisit?: boolean }) {
  const router = useRouter();
  const focused = useIsFocused();
  const { windowTop, tabBarHidden } = use(VisitBandLayout);
  const reduceTransparency = useReduceTransparency();
  const { visit, venue, ready } = useVenue();
  const { works, loading, error } = useVisitWorks(visit?.localId, useLocalOwner());
  const { starting, start, choose } = useStartVisit({ openCamera: !onCamera });
  const museumPhoto = useCurrentMuseumPhoto();
  const padding = useHorizontalSafeAreaPadding();
  if (tabBarHidden || !(visit || (beforeVisit && ready))) return null;
  const backdrop = (
    <VisitBackdrop
      works={works}
      museumPhoto={museumPhoto}
      scrim={styles.scrim}
      watermark={styles.watermark}
      blurRadius={BLUR_RADIUS}
    />
  );
  return (
    <SafeAreaBand style={[styles.band, !onCamera && styles.headerGap]}>
      <View style={[styles.surface, { paddingTop: windowTop }, padding]}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[StyleSheet.absoluteFill, styles.passThrough]}
        >
          {reduceTransparency && visit ? (
            <View style={[StyleSheet.absoluteFill, styles.opaque]} />
          ) : onCamera && (newestPhoto(works) || museumPhoto) ? (
            // The photo matches the band on the other tabs; the blend keeps a second picture from sitting over the camera.
            <>
              <BlurView tint="systemUltraThinMaterialDark" intensity={CAMERA_BLUR} style={StyleSheet.absoluteFill} />
              <View style={[StyleSheet.absoluteFill, styles.blend]}>{backdrop}</View>
              <View style={[StyleSheet.absoluteFill, styles.blendScrim]} />
            </>
          ) : (
            backdrop
          )}
        </View>
        {visit ? (
          <OpenVisitRow
            visit={visit}
            here={visit.venueId === venue?.venueId}
            onCamera={onCamera}
            count={loading || error ? undefined : `${works.length} ${works.length === 1 ? "artwork" : "artworks"}`}
          />
        ) : (
          ready && (
            <View style={styles.row}>
              <BandButton
                label={ready.kind === "here" ? ready.venue.name : "Which museum?"}
                hint="Opens the museum chooser"
                chevron="chevron.down"
                onPress={() => router.push("/venue-picker")}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityHint={ready.kind === "here" ? undefined : "Opens the museum chooser"}
                accessibilityState={{ disabled: starting, busy: starting }}
                disabled={starting}
                onPress={() => (ready.kind === "here" ? start(ready.venue.venueId) : choose())}
                style={({ pressed }) => [styles.action, pressed && styles.pressed]}
              >
                <View style={[styles.pill, styles.startPill]}>
                  <Text type="smallBold" maxFontSizeMultiplier={MAX_TEXT_SCALE} style={styles.start}>
                    Start visit
                  </Text>
                </View>
              </Pressable>
            </View>
          )
        )}
        {/* Light text on the band's photo; screens above the tabs keep their own status bar. */}
        {focused && <StatusBar style="light" />}
      </View>
    </SafeAreaBand>
  );
}

function OpenVisitRow({
  visit,
  here,
  onCamera,
  count,
}: {
  visit: CurrentVisit;
  /** Away from its museum the visit is paused, not over: only the person ends it. */
  here: boolean;
  onCamera: boolean;
  count?: string;
}) {
  const router = useRouter();
  return (
    <View style={styles.row}>
      <BandButton
        label={visit.venueName}
        accessibilityLabel={here ? `Visiting ${visit.venueName}` : `Visit open at ${visit.venueName}`}
        value={[`since ${formatVisitStart(visit.startedAt, visit.timeZone)}`, count].filter(Boolean).join(", ")}
        hint="Opens the visit"
        chevron="chevron.right"
        onPress={() => router.push({ pathname: "/journal/[visitId]", params: { visitId: visit.localId } })}
      />
      {!onCamera && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Scan"
          accessibilityHint="Opens the camera"
          onPress={() => router.navigate("/scan")}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <GlassSurface isInteractive style={[styles.glass, styles.circle]}>
            <Image source="sf:camera.viewfinder" tintColor={ON_PHOTO} style={styles.icon} />
          </GlassSurface>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="End visit"
        accessibilityHint="Opens a review before saving and ending the visit"
        onPress={() =>
          router.push({ pathname: "/journal/[visitId]", params: { visitId: visit.localId, endVisit: "true" } })
        }
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        <GlassSurface isInteractive style={[styles.glass, styles.pill]}>
          <Text type="smallBold" maxFontSizeMultiplier={MAX_TEXT_SCALE} style={styles.end}>
            End
          </Text>
        </GlassSurface>
      </Pressable>
    </View>
  );
}

/** The museum's name across the band; it opens the visit, or the chooser before one starts. */
function BandButton({
  label,
  accessibilityLabel = label,
  value,
  hint,
  chevron,
  onPress,
}: {
  label: string;
  accessibilityLabel?: string;
  value?: string;
  hint: string;
  chevron: "chevron.right" | "chevron.down";
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={value === undefined ? undefined : { text: value }}
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => [styles.visit, pressed && styles.pressed]}
    >
      <Image source="sf:building.columns.fill" tintColor={ON_PHOTO} style={styles.icon} />
      <Text numberOfLines={1} maxFontSizeMultiplier={MAX_TEXT_SCALE} style={styles.name}>
        {label}
      </Text>
      <Image
        source={`sf:${chevron}`}
        tintColor={ON_PHOTO}
        style={chevron === "chevron.down" ? styles.chevronDown : styles.chevron}
      />
    </Pressable>
  );
}

const ON_PHOTO = Colors.light.overlayText;
const BLUR_RADIUS = 6;
const CAMERA_BLUR = 60;
// Like the navigation and tab bars, the band stops growing at accessibility text sizes so the museum name keeps room.
const MAX_TEXT_SCALE = 1.4;
const BUTTON_SIZE = 34;

const styles = StyleSheet.create({
  band: { position: "absolute", top: 0, left: 0, right: 0, pointerEvents: "box-none" },
  // A clear strip inside the reserved safe area keeps the header's glass buttons off the photo; the camera spaces its
  // own controls.
  headerGap: { paddingBottom: Spacing.compact },
  surface: { overflow: "hidden" },
  passThrough: { pointerEvents: "none" },
  opaque: { backgroundColor: Gallery.ink },
  // White text keeps 4.5:1 over a cream photo; only a near-white one leans on the text shadow.
  scrim: { backgroundColor: "rgba(10, 14, 20, 0.5)" },
  blend: { opacity: 0.6 },
  // Keeps white text above 4.5:1 over a white wall, even with a bright photo in the blend.
  blendScrim: { backgroundColor: "rgba(10, 14, 20, 0.35)" },
  watermark: { right: -16, bottom: -36, width: 128, height: 128 },
  row: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.compact,
  },
  visit: { flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", gap: Spacing.two },
  pressed: { opacity: 0.7 },
  icon: { width: 18, height: 18 },
  chevron: { width: 9, height: 14 },
  chevronDown: { width: 12, height: 12 },
  name: { flexShrink: 1, fontSize: 17, lineHeight: 22, fontWeight: "600", color: ON_PHOTO, ...OnPhoto.textShadow },
  // The touch target surrounds the smaller glass surface so clipping cannot trim its tappable margin.
  action: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  glass: { borderRadius: Radius.full, overflow: "hidden" },
  circle: { width: BUTTON_SIZE, height: BUTTON_SIZE, alignItems: "center", justifyContent: "center" },
  pill: { minHeight: BUTTON_SIZE, justifyContent: "center", paddingHorizontal: Spacing.three },
  end: { color: ON_PHOTO, fontSize: 15, lineHeight: 20 },
  // Opaque, unlike End's glass: the one action on the blue band before a visit.
  startPill: { borderRadius: Radius.full, backgroundColor: Gallery.paper },
  start: { color: Gallery.accent, fontSize: 15, lineHeight: 20 },
});
