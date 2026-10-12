import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { GuideTranscript } from "@/components/audio/guide-transcript";
import { ListenActions } from "@/components/audio/listen-actions";
import { DocentSection } from "@/components/scan/result/docent-section";
import { Spacing } from "@/constants/theme";
import type { ContentReportTarget } from "@/lib/social/report";

import type { Id } from "../../../convex/_generated/dataModel";
import type { DocentSentence, DocentStatus, FactChip } from "../../../convex/lib/validators";

/** "About this work", then the audio guide once the work has research to read from. `children` follow the guide. */
export function ArtworkStory({
  artworkId,
  title,
  artist,
  date,
  imageUri,
  scanId,
  savedId,
  docent,
  factSheet,
  status,
  onRetry,
  waitWhileWriting,
  report,
  children,
}: {
  /** The catalog work behind the guide; without one there is nothing to listen to. */
  artworkId?: Id<"artworks">;
  title: string;
  artist: string;
  date?: string | null;
  imageUri?: string;
  scanId?: string;
  savedId?: string;
  docent?: DocentSentence[];
  factSheet?: FactChip[];
  status?: DocentStatus;
  onRetry?: () => Promise<unknown>;
  waitWhileWriting?: boolean;
  report?: ContentReportTarget;
  children?: ReactNode;
}) {
  return (
    <View style={styles.story}>
      <DocentSection
        title="About this work"
        docent={docent}
        factSheet={factSheet}
        status={status}
        onRetry={onRetry}
        waitWhileWriting={waitWhileWriting}
        report={report}
      />
      {artworkId && (
        <>
          <ListenActions
            artworkId={artworkId}
            title={title}
            artist={artist}
            date={date}
            scanId={scanId}
            savedId={savedId}
            imageUri={imageUri}
          />
          <GuideTranscript artworkId={artworkId} />
        </>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  story: { gap: Spacing.three },
});
