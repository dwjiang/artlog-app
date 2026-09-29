import { ThemedText } from "@/components/themed-text";
import type { CaptureCompletion } from "@/lib/capture/completion";

export function CaptureArtworkMetadata({ completion }: { completion: CaptureCompletion }) {
  const attribution = [completion.artist, completion.date].filter(Boolean).join(" · ");
  return (
    <>
      {attribution && (
        <ThemedText variant="secondary" themeColor="textSecondary">
          {attribution}
        </ThemedText>
      )}
      {completion.medium && (
        <ThemedText variant="metadata" themeColor="textSecondary">
          {completion.medium}
        </ThemedText>
      )}
      {completion.visitLabel && (
        <ThemedText variant="metadata" themeColor="textSecondary">
          {completion.visitLabel}
        </ThemedText>
      )}
    </>
  );
}
