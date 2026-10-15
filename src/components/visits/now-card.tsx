import { useRouter } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import { createContext, use, useEffect, type ReactNode } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import Animated, { Easing, FadeIn, LayoutAnimationConfig, ReduceMotion } from "react-native-reanimated";

import { GalleryButton } from "@/components/collection/gallery-button";
import { GlassSurface } from "@/components/glass-surface";
import { ThemedText as Text } from "@/components/themed-text";
import { Colors, Gallery, Motion, OnPhoto, Radius, Spacing } from "@/constants/theme";
import { useScrolledUnderBar } from "@/hooks/use-scrolled-under-bar";
import { useLocalOwner } from "@/lib/account/owner-store";
import { formatVisitStart } from "@/lib/journal/history";
import { useVisitWorks } from "@/lib/journal/use-visit-works";
import { reportError } from "@/lib/observability";
import { showErrorToast } from "@/lib/ui/toast";
import { photoCredit, useCurrentMuseumPhoto, type MuseumPhoto } from "@/lib/venue/use-museum-photo";
import { useStartVisit } from "@/lib/venue/use-start-visit";
import { useVenue } from "@/lib/venue/use-venue";

import { DontMiss } from "./dont-miss";
import { newestPhoto, VisitBackdrop } from "./visit-backdrop";

// Starting or ending a visit fades the card's new face in; a fade, so it stays with Reduce Motion on.
const SWAP = FadeIn.duration(Motion.state)
  .easing(Easing.bezier(...Motion.easeOut))
  .reduceMotion(ReduceMotion.Never);

/** Set by Home's layout, which shows the visit band once the Now card has scrolled under the navigation bar. */
export const NowCardScrolledAway = createContext<((away: boolean) => void) | undefined>(undefined);

/**
 * Tells Home's layout whether the Now card has scrolled under the navigation bar. Pass `onCardLayout` to a
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
 * Home's "Now" card: Start visit at the museum the phone is at, or a choice between several nearby, then the visit in
 * progress. A visit paused elsewhere stays on the card as open so it can still be reviewed and ended.
 */
export function NowCard({ onLayout }: { onLayout?: (event: LayoutChangeEvent) => void }) {
  const router = useRouter();
  const owner = useLocalOwner();
  const { venue, visit, ready, options } = useVenue();
  const { works, loading, error } = useVisitWorks(visit?.localId, owner);
  const { starting, start, choose } = useStartVisit({ openCamera: true });
  const museumPhoto = useCurrentMuseumPhoto();
  const stacked = useWindowDimensions().fontScale >= 1.5;
  if (!visit && !ready) return null;
  const here = !!visit && visit.venueId === venue?.venueId;
  // A saved artwork's photo takes over from the museum's.
  const shownMuseumPhoto = newestPhoto(works) ? undefined : museumPhoto;
  const count = loading || error || works.length === 0 ? undefined : works.length;
  let card: ReactNode;
  if (visit) {
    const caption = [
      `Since ${formatVisitStart(visit.startedAt, visit.timeZone)}`,
      count && `${count} ${count === 1 ? "artwork" : "artworks"}`,
    ]
      .filter(Boolean)
      .join(" · ");
    card = (
      <>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={here ? `Visiting ${visit.venueName}` : `Visit open at ${visit.venueName}`}
          accessibilityValue={{ text: caption }}
          accessibilityHint="Opens the visit"
          onPress={() => router.push({ pathname: "/journal/[visitId]", params: { visitId: visit.localId } })}
          style={({ pressed }) => [StyleSheet.absoluteFill, pressed && styles.pressed]}
        >
          <VisitBackdrop
            works={works}
            museumPhoto={museumPhoto}
            scrim={shownMuseumPhoto ? styles.museumScrim : styles.scrim}
            watermark={styles.watermark}
          />
        </Pressable>
        {/* Taps on the text fall through to the card behind it; only the buttons take their own. */}
        <View style={styles.content}>
          <TopLine photo={shownMuseumPhoto}>{here ? undefined : "Visit open"}</TopLine>
          <View style={styles.boxNone}>
            <Name>{visit.venueName}</Name>
            <Text style={[styles.caption, styles.passThrough]}>{caption}</Text>
            {/* Scan takes Start visit's place; End visit, used once per visit, stays quieter on glass. */}
            <View style={[styles.action, styles.actions, stacked && styles.stacked]}>
              <View style={!stacked && styles.scan}>
                <GalleryButton
                  label="Scan artwork"
                  icon="camera.viewfinder"
                  variant="filled"
                  inverse
                  fullWidth
                  size="compact"
                  cornerRadius={Radius.full}
                  onPress={() => router.navigate("/scan")}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityHint="Opens a review before saving and ending the visit"
                onPress={() =>
                  router.push({ pathname: "/journal/[visitId]", params: { visitId: visit.localId, endVisit: "true" } })
                }
                style={({ pressed }) => pressed && styles.pressed}
              >
                <GlassSurface isInteractive style={styles.end}>
                  <Text style={styles.endLabel}>End visit</Text>
                </GlassSurface>
              </Pressable>
            </View>
          </View>
        </View>
      </>
    );
  } else if (ready?.kind === "here") {
    card = (
      <ReadyCard
        top="Are you here?"
        name={ready.venue.name}
        photo={museumPhoto}
        action={
          <GalleryButton
            label="Start visit"
            icon="camera.viewfinder"
            variant="filled"
            inverse
            fullWidth
            size="compact"
            cornerRadius={Radius.full}
            busy={starting}
            busyLabel="Starting…"
            onPress={() => start(ready.venue.venueId)}
          />
        }
      />
    );
  } else {
    card = (
      <ReadyCard
        top={`${options.length} museums nearby`}
        name="Which museum are you in?"
        action={
          <GalleryButton
            label="Choose museum"
            variant="filled"
            inverse
            fullWidth
            size="compact"
            cornerRadius={Radius.full}
            onPress={choose}
          />
        }
      />
    );
  }
  return (
    <>
      <View style={styles.section} onLayout={onLayout}>
        <Text variant="section" accessibilityRole="header" style={styles.heading}>
          Now
        </Text>
        <View style={styles.shadow}>
          <View style={styles.card}>
            {/* Home opening on either face shows it at once. */}
            <LayoutAnimationConfig skipEntering>
              <Animated.View key={visit?.localId ?? "ready"} entering={SWAP}>
                {card}
              </Animated.View>
            </LayoutAnimationConfig>
          </View>
        </View>
      </View>
      {/* Suggestions only fit where the phone is; a visit left open elsewhere gets none. */}
      <DontMiss venueId={here ? visit.venueId : ready?.kind === "here" ? ready.venue.venueId : undefined} />
    </>
  );
}

function ReadyCard({
  top,
  name,
  photo,
  action,
}: {
  top: string;
  name: string;
  photo?: MuseumPhoto;
  action: ReactNode;
}) {
  return (
    <>
      <VisitBackdrop
        works={[]}
        museumPhoto={photo}
        scrim={photo ? styles.museumScrim : styles.scrim}
        watermark={styles.watermark}
      />
      <View style={styles.content}>
        <TopLine photo={photo}>{top}</TopLine>
        <View style={styles.boxNone}>
          <Name>{name}</Name>
          <View style={styles.action}>{action}</View>
        </View>
      </View>
    </>
  );
}

/** A plain line of status over the card, in place of a chip, and the credit for the museum's photo across from it. */
function TopLine({ photo, children }: { photo?: MuseumPhoto; children?: string }) {
  const credit = photo ? photoCredit(photo) : "";
  return (
    <View style={styles.topLine}>
      {children && <Text style={[styles.top, styles.passThrough]}>{children}</Text>}
      {photo && credit !== "" && <PhotoCredit credit={credit} pageUrl={photo.pageUrl} />}
    </View>
  );
}

function PhotoCredit({ credit, pageUrl }: { credit: string; pageUrl: string }) {
  async function open() {
    try {
      await openBrowserAsync(pageUrl);
    } catch (cause) {
      reportError(cause, "venue.photo.open-credit", { level: "warning" });
      showErrorToast("Couldn’t open the page.", () => void open());
    }
  }
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Photo: ${credit}`}
      accessibilityHint="Opens the photo’s page on Wikimedia Commons"
      hitSlop={CREDIT_HIT_SLOP}
      onPress={() => void open()}
      style={({ pressed }) => [styles.credit, pressed && styles.pressed]}
    >
      <Text numberOfLines={1} style={styles.creditText}>
        {credit}
      </Text>
    </Pressable>
  );
}

function Name({ children }: { children: string }) {
  return (
    <Text variant="section" style={[styles.name, styles.passThrough]}>
      {children}
    </Text>
  );
}

// Grows the 11-point credit's touch target to 44 points tall.
const CREDIT_HIT_SLOP = { top: 14, bottom: 14, left: 8, right: 8 };

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
  scrim: OnPhoto.scrim,
  // Building photos often have a bright sky, so the status line and credit get a fade of their own along the top.
  museumScrim: {
    experimental_backgroundImage:
      "linear-gradient(180deg, rgba(10, 14, 20, 0.45) 0%, rgba(10, 14, 20, 0) 30%, rgba(10, 14, 20, 0.78) 100%)",
  },
  watermark: { right: -18, top: Spacing.compact, width: 170, height: 170 },
  pressed: { opacity: 0.85 },
  passThrough: { pointerEvents: "none" },
  boxNone: { pointerEvents: "box-none" },
  content: {
    minHeight: 236,
    padding: Spacing.three,
    paddingTop: Spacing.compact,
    justifyContent: "space-between",
    gap: Spacing.three,
    pointerEvents: "box-none",
  },
  topLine: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.two, pointerEvents: "box-none" },
  top: {
    flexShrink: 0,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.86)",
    ...OnPhoto.textShadow,
  },
  credit: { flexShrink: 1, marginLeft: "auto", paddingTop: 2 },
  creditText: { fontSize: 11, lineHeight: 16, color: "rgba(255, 255, 255, 0.8)", ...OnPhoto.textShadow },
  name: { color: Gallery.paper, fontSize: 24, lineHeight: 30, ...OnPhoto.textShadow },
  action: { marginTop: Spacing.compact },
  caption: {
    marginTop: Spacing.half,
    fontSize: 14,
    lineHeight: 21,
    color: "rgba(255, 255, 255, 0.85)",
    ...OnPhoto.textShadow,
  },
  actions: { flexDirection: "row", gap: Spacing.two, pointerEvents: "box-none" },
  stacked: { flexDirection: "column" },
  scan: { flex: 1 },
  // As tall as Scan artwork's filled pill beside it.
  end: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: Spacing.content,
    borderRadius: Radius.full,
    overflow: "hidden",
  },
  endLabel: { fontSize: 16, lineHeight: 21, fontWeight: "600", color: Colors.light.overlayText, textAlign: "center" },
});
