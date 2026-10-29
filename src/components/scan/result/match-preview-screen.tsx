import { useRouter } from "expo-router";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ArtworkFrame } from "@/components/artwork/artwork-frame";
import { ArtworkIdentity } from "@/components/artwork/artwork-identity";
import { GalleryButton } from "@/components/collection/gallery-button";
import { SafeAreaScrollView } from "@/components/safe-area-scroll";
import { SocialState, StateScreen } from "@/components/social/social-state";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Colors, PinnedFooterBorder, Radius, Spacing } from "@/constants/theme";
import { pageSizedImage } from "@/lib/catalog/catalog-image";
import { reportError } from "@/lib/observability";
import { formatConfidence } from "@/lib/result/confidence";
import { getMatchPreview } from "@/lib/result/match-preview";
import type { ResultCandidate } from "@/lib/result/state";
import { useHorizontalSafeAreaPadding } from "@/lib/ui/safe-area";
import { useLandscape } from "@/lib/ui/use-landscape";

import { StatusChip } from "./confidence-chip";
import { TentativeOriginNotice } from "./tentative-origin-notice";

export const CHOOSE_MATCH = "Choose this artwork";

/** Another possible match beside the owner's photo; looking records nothing, and only the footer chooses it. */
export function MatchPreviewScreen({ previewId }: { previewId?: string }) {
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const footerPadding = useHorizontalSafeAreaPadding(styles.footer);
  const preview = getMatchPreview(previewId);
  if (!preview) {
    return (
      <StateScreen>
        <SocialState title="This match is no longer open." action="Go back" onAction={() => router.back()} />
      </StateScreen>
    );
  }
  const { candidate, photoUri, onChoose } = preview;
  return (
    <ThemedView style={styles.page}>
      <SafeAreaScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <MatchPictures candidate={candidate} photoUri={photoUri} />
          <StatusChip label="Possible match" detail={formatConfidence(candidate.probability)} style={styles.chip} />
        </View>
        <ArtworkIdentity
          title={candidate.title}
          artist={candidate.artist}
          date={candidate.date}
          medium={candidate.medium}
          institution={candidate.institution}
        />
        {candidate.identityStatus === "tentative" && <TentativeOriginNotice />}
      </SafeAreaScrollView>
      <View style={[styles.footer, footerPadding, { paddingBottom: Math.max(12, bottom) }]}>
        <GalleryButton
          label={CHOOSE_MATCH}
          variant="filled"
          fullWidth
          onPress={() => {
            onChoose(candidate);
            router.back();
          }}
        />
      </View>
    </ThemedView>
  );
}

/** The owner's photo above the candidate's image at the same width, so their shapes line up; side by side on a phone held sideways. */
function MatchPictures({ candidate, photoUri }: { candidate: ResultCandidate; photoUri?: string }) {
  const { height } = useWindowDimensions();
  const landscape = useLandscape();
  const source = candidate.identityStatus === "tentative" ? "Visitor photo" : "Museum image";
  if (!candidate.thumbnailUrl) {
    return (
      <ArtworkFrame
        accessibilityLabel={`No image of ${candidate.title}`}
        unavailableText="No public-domain image"
        unavailableTitle={candidate.title}
      />
    );
  }
  const theirs = (
    <ArtworkFrame
      uri={pageSizedImage(candidate.thumbnailUrl)}
      // Two frames share the screen, so each stops short of the usual third of it.
      maxHeight={photoUri && !landscape ? height * 0.28 : undefined}
      accessibilityLabel={`${source} of ${candidate.title}`}
      unavailableText={`${source} unavailable`}
      onError={(message) =>
        reportError(new Error(message ?? "Match image unavailable"), "result.load_match_image", { level: "warning" })
      }
    >
      {photoUri && <PictureLabel text={source} />}
    </ArtworkFrame>
  );
  if (!photoUri) return theirs;
  return (
    <View style={landscape ? styles.row : styles.stack}>
      <View style={landscape && styles.half}>
        <ArtworkFrame
          uri={photoUri}
          cachePolicy="memory"
          maxHeight={landscape ? undefined : height * 0.28}
          accessibilityLabel="Your photo of this painting"
        >
          <PictureLabel text="Your photo" />
        </ArtworkFrame>
      </View>
      <View style={landscape && styles.half}>{theirs}</View>
    </View>
  );
}

function PictureLabel({ text }: { text: string }) {
  return (
    <View style={styles.label} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <ThemedText type="smallBold" style={styles.labelText}>
        {text}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.content,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
    gap: Spacing.two,
  },
  header: { gap: Spacing.compact },
  chip: { alignSelf: "flex-start" },
  stack: { gap: Spacing.two },
  row: { flexDirection: "row", gap: Spacing.two },
  half: { flex: 1 },
  label: {
    position: "absolute",
    top: Spacing.two,
    left: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Radius.thumbnail,
    backgroundColor: Colors.light.overlayScrim,
  },
  labelText: { color: Colors.light.overlayText },
  footer: {
    paddingHorizontal: Spacing.content,
    paddingTop: Spacing.two,
    ...PinnedFooterBorder,
  },
});
