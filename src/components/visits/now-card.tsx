import { useRouter } from "expo-router";
import { createContext, use, useEffect, type ReactNode } from "react";
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, OnPhoto, Radius, Spacing } from "@/constants/theme";
import { useScrolledUnderBar } from "@/hooks/use-scrolled-under-bar";
import { useLocalOwner } from "@/lib/account/owner-store";
import { formatVisitStart } from "@/lib/journal/history";
import { useVisitWorks } from "@/lib/journal/use-visit-works";
import { useStartVisit } from "@/lib/venue/use-start-visit";
import { useVenue } from "@/lib/venue/use-venue";

import { DontMiss } from "./dont-miss";
import { VisitBackdrop } from "./visit-backdrop";

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
  if (!visit && !ready) return null;
  const here = !!visit && visit.venueId === venue?.venueId;
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
          <VisitBackdrop works={works} scrim={styles.scrim} watermark={styles.watermark} />
        </Pressable>
        {/* Taps on the text fall through to the card behind it; only the button takes its own. */}
        <View style={[styles.content, styles.inVisit]}>
          <TopLine>{here ? undefined : "Visit open"}</TopLine>
          <View style={styles.boxNone}>
            <Name>{visit.venueName}</Name>
            <View style={styles.captionRow}>
              <Text style={[styles.caption, styles.passThrough]}>{caption}</Text>
              {/* Centred on the caption without adding to its height, so the caption stays under the name. */}
              <View style={styles.end}>
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
          </View>
        </View>
      </>
    );
  } else if (ready?.kind === "here") {
    card = (
      <ReadyCard
        top="You’re here"
        name={ready.venue.name}
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
          <View style={styles.card}>{card}</View>
        </View>
      </View>
      {/* Suggestions only fit where the phone is; a visit left open elsewhere gets none. */}
      <DontMiss venueId={here ? visit.venueId : ready?.kind === "here" ? ready.venue.venueId : undefined} />
    </>
  );
}

function ReadyCard({ top, name, action }: { top: string; name: string; action: ReactNode }) {
  return (
    <>
      <VisitBackdrop works={[]} scrim={styles.scrim} watermark={styles.watermark} />
      <View style={styles.content}>
        <TopLine>{top}</TopLine>
        <View style={styles.boxNone}>
          <Name>{name}</Name>
          <View style={styles.action}>{action}</View>
        </View>
      </View>
    </>
  );
}

/** A plain line of status over the card, in place of a chip. */
function TopLine({ children }: { children?: string }) {
  return <View style={styles.passThrough}>{children && <Text style={styles.top}>{children}</Text>}</View>;
}

function Name({ children }: { children: string }) {
  return (
    <Text variant="section" style={[styles.name, styles.passThrough]}>
      {children}
    </Text>
  );
}

// End's 44-point target reaches this far above and below the 21-point caption line it is centred on.
const END_OVERHANG = (44 - 21) / 2;

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
  // Leaves End's pill as far from the card's bottom edge as the card's side padding.
  inVisit: { paddingBottom: Spacing.three + END_OVERHANG },
  top: { fontSize: 15, lineHeight: 20, fontWeight: "600", color: "rgba(255, 255, 255, 0.86)", ...OnPhoto.textShadow },
  name: { color: Gallery.paper, fontSize: 24, lineHeight: 30, ...OnPhoto.textShadow },
  action: { marginTop: Spacing.compact },
  captionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.compact,
    marginTop: Spacing.half,
    pointerEvents: "box-none",
  },
  caption: { flex: 1, fontSize: 14, lineHeight: 21, color: "rgba(255, 255, 255, 0.85)", ...OnPhoto.textShadow },
  end: { marginVertical: -END_OVERHANG },
});
