import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { createContext, use, useEffect } from "react";
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { SavedWorkImage } from "@/components/collection/saved-work-image";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing } from "@/constants/theme";
import { useScrolledUnderBar } from "@/hooks/use-scrolled-under-bar";
import { useLocalOwner } from "@/lib/account/owner-store";
import { formatVisitStart } from "@/lib/journal/history";
import { useVisitWorks } from "@/lib/journal/use-visit-works";
import { useVenue, visitByDefault } from "@/lib/venue/use-venue";

import { DontMiss } from "./dont-miss";

/** Set by the tab layout, which shows the visit bar on Home once the Now card has scrolled under the navigation bar. */
export const NowCardScrolledAway = createContext<((away: boolean) => void) | undefined>(undefined);

/**
 * Tells the tab layout whether Home's Now card has scrolled under the navigation bar. Pass `onCardLayout` to a
 * `NowCard` that is a direct child of the scroll content, and the list's scroll events to `onScroll`.
 */
export function useNowCardScroll() {
  const report = use(NowCardScrolledAway);
  const { recordEdge, onScroll } = useScrolledUnderBar((away) => report?.(away));
  // A remounted Home starts scrolled to the top, with its card in view.
  useEffect(() => () => report?.(false), [report]);
  return {
    onCardLayout: ({ nativeEvent: { layout } }: LayoutChangeEvent) => recordEdge(layout.y + layout.height),
    onScroll,
  };
}

/**
 * Home's "Now" card: the museum the phone is at before anything is saved there, then the visit in progress. A visit
 * paused elsewhere stays on the card as "Visit open" so it can still be reviewed and ended.
 */
export function NowCard({ onLayout }: { onLayout?: (event: LayoutChangeEvent) => void }) {
  const router = useRouter();
  const owner = useLocalOwner();
  const { venue, visit } = useVenue();
  const { works, loading, error } = useVisitWorks(visit?.localId, owner);
  const here = !!visit && visit.venueId === venue?.venueId;
  const nearby = !visit && venue && visitByDefault(venue.venueId) ? venue : undefined;
  if (!visit && !nearby) return null;
  const name = visit?.venueName ?? nearby?.name ?? "";
  // The newest saved artwork with a photo; a save without one keeps the museum glyph rather than a placeholder frame.
  const hero = works.find((work) => work.cropPath);
  const count = loading || error ? undefined : works.length;
  const status = visit ? (here ? "Visiting now" : "Visit open") : "You’re here";
  const openVisit = () => {
    if (visit) router.push({ pathname: "/journal/[visitId]", params: { visitId: visit.localId } });
  };
  const scan = () => router.navigate("/scan");
  return (
    <>
      <View style={styles.section} onLayout={onLayout}>
        <Text variant="section" accessibilityRole="header" style={styles.heading}>
          Now
        </Text>
        <View style={styles.shadow}>
          <View style={styles.card}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${status}, ${name}`}
              accessibilityHint={visit ? "Opens the visit" : "Opens the camera"}
              onPress={visit ? openVisit : scan}
              style={({ pressed }) => [StyleSheet.absoluteFill, !hero && styles.blue, pressed && styles.pressed]}
            >
              {hero ? (
                <>
                  <SavedWorkImage path={hero.cropPath} title={hero.title} style={StyleSheet.absoluteFill} />
                  <View style={styles.scrim} />
                </>
              ) : (
                <Image source="sf:building.columns.fill" tintColor={WATERMARK} style={styles.watermark} />
              )}
            </Pressable>
            {/* Taps on the text fall through to the card behind it; only the button takes its own. */}
            <View style={styles.content}>
              <View style={[styles.chip, styles.passThrough]}>
                <Text type="smallBold" style={visit && !here ? styles.chipPausedText : styles.chipText}>
                  {status}
                </Text>
              </View>
              <View style={styles.bottom}>
                <Text variant="section" style={[styles.name, styles.passThrough]}>
                  {name}
                </Text>
                {visit ? (
                  <View style={styles.row}>
                    <Stat value={formatVisitStart(visit.startedAt, visit.timeZone)} label="Started" />
                    <Stat
                      value={count === undefined ? "–" : String(count)}
                      label={count === 1 ? "Artwork" : "Artworks"}
                    />
                    <View style={styles.trailing}>
                      <GalleryButton
                        label="End"
                        accessibilityLabel="End visit"
                        variant="filled"
                        inverse
                        size="compact"
                        cornerRadius={Radius.full}
                        onPress={() =>
                          router.push({
                            pathname: "/journal/[visitId]",
                            params: { visitId: visit.localId, endVisit: "true" },
                          })
                        }
                      />
                    </View>
                  </View>
                ) : (
                  <>
                    <Text variant="secondary" style={[styles.lead, styles.passThrough]}>
                      Scan an artwork to start today’s visit.
                    </Text>
                    <View style={styles.row}>
                      <GalleryButton
                        label="Scan"
                        icon="camera.viewfinder"
                        variant="filled"
                        inverse
                        size="compact"
                        cornerRadius={Radius.full}
                        onPress={scan}
                      />
                    </View>
                  </>
                )}
              </View>
            </View>
          </View>
        </View>
      </View>
      {/* Suggestions only fit where the phone is; a visit left open elsewhere gets none. */}
      <DontMiss venueId={here ? visit.venueId : nearby?.venueId} />
    </>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={[styles.stat, styles.passThrough]} accessible accessibilityLabel={`${label} ${value}`}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const WATERMARK = "rgba(255, 255, 255, 0.14)";
const ON_PHOTO_MUTED = "rgba(255, 255, 255, 0.72)";
const TEXT_SHADOW = {
  textShadowColor: "rgba(0, 0, 0, 0.35)",
  textShadowRadius: 6,
  textShadowOffset: { width: 0, height: 1 },
};

const styles = StyleSheet.create({
  section: { paddingHorizontal: Spacing.content, paddingBottom: Spacing.two },
  heading: { paddingBottom: Spacing.two },
  // The shadow sits outside the clipping card, which would otherwise cut it off on iOS.
  shadow: {
    borderRadius: Radius.card,
    shadowColor: Gallery.ink,
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 10 },
  },
  card: { borderRadius: Radius.card, overflow: "hidden", backgroundColor: Gallery.ink },
  blue: {
    backgroundColor: Gallery.accent,
    experimental_backgroundImage: "linear-gradient(150deg, #3A63E0 0%, #254FD4 45%, #1C3DA8 100%)",
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    experimental_backgroundImage: "linear-gradient(180deg, rgba(0, 0, 0, 0) 30%, rgba(10, 14, 20, 0.78) 100%)",
  },
  watermark: { position: "absolute", right: -18, top: Spacing.compact, width: 170, height: 170 },
  pressed: { opacity: 0.85 },
  passThrough: { pointerEvents: "none" },
  content: {
    minHeight: 236,
    padding: Spacing.three,
    paddingTop: Spacing.compact,
    justifyContent: "space-between",
    gap: Spacing.three,
    pointerEvents: "box-none",
  },
  chip: {
    alignSelf: "flex-start",
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.compact,
    paddingVertical: Spacing.one,
    backgroundColor: "rgba(255, 255, 255, 0.94)",
  },
  chipText: { color: Gallery.accent },
  chipPausedText: { color: Gallery.muted },
  bottom: { gap: Spacing.one, pointerEvents: "box-none" },
  // The shadow keeps white text legible where a bright photo shows through the fade.
  name: { color: Gallery.paper, fontSize: 24, lineHeight: 30, ...TEXT_SHADOW },
  lead: { color: "rgba(255, 255, 255, 0.85)" },
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: Spacing.four,
    marginTop: Spacing.two,
    pointerEvents: "box-none",
  },
  trailing: { marginLeft: "auto" },
  stat: { gap: 1 },
  statValue: { fontSize: 17, lineHeight: 22, fontWeight: "600", color: Gallery.paper, ...TEXT_SHADOW },
  statLabel: { fontSize: 11, lineHeight: 14, letterSpacing: 0.6, textTransform: "uppercase", color: ON_PHOTO_MUTED },
});
