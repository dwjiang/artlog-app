import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useRef, useState, type ReactNode } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";

import { ActionStack } from "@/components/action-stack";
import { GalleryButton } from "@/components/collection/gallery-button";
import { SavedWorkImage } from "@/components/collection/saved-work-image";
import { WallSheet } from "@/components/collection/wall-sheet";
import { ParagraphSkeleton } from "@/components/loading-skeleton";
import { ThemedText } from "@/components/themed-text";
import { Gallery, Radius, Spacing } from "@/constants/theme";
import { useArtworkNote } from "@/hooks/use-artwork-note";
import { useLocalOwner } from "@/lib/account/owner-store";
import type { CaptureCompletion as Completion, CompletionVisit } from "@/lib/capture/completion";
import { formatVisitDate, formatVisitStart } from "@/lib/journal/history";
import { useVisitWorks } from "@/lib/journal/use-visit-works";
import { MAX_NOTE_LENGTH, NOTE_LENGTH_MESSAGE } from "@/shared/collection/collection-limits";

import { CaptureArtworkMetadata } from "./capture-artwork-metadata";
import { FieldInput, type FieldInputRef } from "./field-input";

type Props = {
  completion?: Completion;
  children?: ReactNode;
  status?: ReactNode;
  onViewResult?: () => void;
  sharedToIndex?: boolean;
};

export function CaptureCompletion({ children, completion, ...props }: Props) {
  const owner = useLocalOwner();
  const [dismissedId, setDismissedId] = useState<string>();
  const showing = !!completion && completion.savedId !== dismissedId;
  return (
    <View style={styles.page}>
      <View style={styles.page} accessibilityElementsHidden={showing}>
        {children}
      </View>
      {completion && (
        <CompletionSheet
          key={`${owner}:${completion.savedId}`}
          {...props}
          owner={owner}
          completion={completion}
          onDismissed={() => setDismissedId(completion.savedId)}
        />
      )}
    </View>
  );
}

function CompletionSheet({
  completion,
  onViewResult,
  sharedToIndex = false,
  status,
  onDismissed,
  owner,
}: Props & { completion: Completion; onDismissed: () => void; owner: string }) {
  const router = useRouter();
  const { fontScale } = useWindowDimensions();
  const [presented, setPresented] = useState(true);
  const [saving, setSaving] = useState(false);
  const note = useArtworkNote(completion.savedId, owner);
  const noteInput = useRef<FieldInputRef>(null);
  const pendingAction = useRef<(() => void) | undefined>(undefined);
  const closing = useRef(false);
  const dismissed = useRef(false);
  const openArtwork = () => router.navigate({ pathname: "/saved/[savedId]", params: { savedId: completion.savedId } });

  async function dismiss(action?: () => void) {
    if (closing.current) return;
    closing.current = true;
    // SwiftUI's value can be ahead of its JavaScript change event when a save is tapped.
    const text = noteInput.current?.getText();
    if (text !== undefined) note.setDraft(text);
    setSaving(true);
    if (!(await note.save())) {
      closing.current = false;
      setSaving(false);
      return;
    }
    pendingAction.current = action;
    setPresented(false);
  }

  return (
    <WallSheet
      title="Saved to collection"
      presented={presented}
      scrollAll={fontScale > 1.4}
      dismissDisabled={saving || (note.draft !== undefined && note.draft !== note.savedText)}
      onDismiss={() => void dismiss()}
      onDismissed={() => {
        if (dismissed.current) return;
        dismissed.current = true;
        onDismissed();
        // Navigate only after the native presentation has fully ended.
        pendingAction.current?.();
      }}
      header={
        <View style={styles.header} accessibilityLiveRegion="polite">
          <View style={styles.check}>
            <Image source="sf:checkmark" style={styles.checkIcon} tintColor={Gallery.accent} />
          </View>
          <ThemedText variant="section" accessibilityRole="header" style={styles.heading}>
            Saved to collection
          </ThemedText>
          <GalleryButton
            label="Close confirmation"
            icon="xmark"
            iconOnly
            fullWidth={false}
            tone="ink"
            disabled={saving}
            onPress={() => void dismiss()}
          />
        </View>
      }
      footer={
        <ActionStack
          style={styles.actions}
          textActions={
            <>
              <GalleryButton
                label="View artwork"
                fullWidth
                disabled={saving}
                onPress={() => void dismiss(openArtwork)}
              />
              {onViewResult && (
                <GalleryButton
                  label="View result"
                  fullWidth
                  disabled={saving}
                  onPress={() => void dismiss(onViewResult)}
                />
              )}
            </>
          }
        >
          <GalleryButton
            label="Scan next artwork"
            icon="arrow.right"
            iconPosition="trailing"
            variant="filled"
            fullWidth
            busy={saving}
            busyLabel="Saving note…"
            onPress={() =>
              void dismiss(() => {
                router.dismissAll();
                router.navigate("/(tabs)/(scan)/scan");
              })
            }
          />
        </ActionStack>
      }
    >
      <View style={styles.content}>
        <View style={[styles.summary, fontScale > 1.4 && styles.stacked]}>
          <SavedWorkImage path={completion.previewPath} title={completion.title} contain style={styles.thumbnail} />
          <View style={styles.identity}>
            <ThemedText variant="section" selectable>
              {completion.title}
            </ThemedText>
            <CaptureArtworkMetadata completion={completion} />
          </View>
        </View>
        {completion.visit && <CompletionVisitRow visit={completion.visit} owner={owner} />}
        <View style={styles.noteSection}>
          <ThemedText variant="secondary" accessibilityRole="header" style={styles.noteTitle}>
            Note
          </ThemedText>
          {note.loadFailed ? (
            <ThemedText accessibilityRole="alert" themeColor="error">
              Your note could not load. Reopen this artwork to try again.
            </ThemedText>
          ) : note.draft === undefined ? (
            <ParagraphSkeleton label="Loading your note…" />
          ) : (
            <FieldInput
              ref={noteInput}
              label="Private note"
              placeholder="Add a note…"
              variant="filled"
              icon={note.draft ? undefined : "pencil"}
              defaultValue={note.draft}
              editable={!saving}
              autoCapitalize="sentences"
              maxLength={MAX_NOTE_LENGTH}
              numberOfLines={3}
              onChangeText={note.setDraft}
              onBlur={() => void note.save()}
            />
          )}
        </View>
        {note.draft?.length === MAX_NOTE_LENGTH && (
          <ThemedText variant="metadata" style={styles.muted}>
            {NOTE_LENGTH_MESSAGE}
          </ThemedText>
        )}
        {note.saveFailed && (
          <View>
            <ThemedText accessibilityRole="alert" themeColor="error">
              Couldn’t save. Your draft is still here.
            </ThemedText>
            <GalleryButton label="Retry save" onPress={() => void note.save()} />
          </View>
        )}
        {sharedToIndex && (
          <View style={styles.sharedNotice}>
            <Image source="sf:person.2" tintColor={Gallery.muted} style={styles.sharedNoticeIcon} />
            <ThemedText variant="metadata" style={[styles.muted, styles.noteLabel]}>
              An artwork crop was saved to the shared index.
            </ThemedText>
          </View>
        )}
        {status}
      </View>
    </WallSheet>
  );
}

/** Where the save landed: the visit it started or joined, with its live artwork count, or the past visit it went to. */
function CompletionVisitRow({ visit, owner }: { visit: CompletionVisit; owner: string }) {
  const { works, loading, error } = useVisitWorks(visit.localId, owner);
  const count = loading || error ? undefined : works.length;
  const title =
    visit.outcome === "started"
      ? "Started your visit"
      : visit.outcome === "joined"
        ? "Added to today’s visit"
        : "Added to a past visit";
  const details = [
    visit.venueName,
    count === undefined ? undefined : `${count} ${count === 1 ? "artwork" : "artworks"}`,
    visit.outcome === "past"
      ? formatVisitDate(visit.visitedOn)
      : visit.startedAt === null
        ? undefined
        : `Since ${formatVisitStart(visit.startedAt, visit.timeZone)}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <View style={styles.visitRow} accessible accessibilityLabel={`${title}. ${details}`}>
      <Image source="sf:building.columns" tintColor={Gallery.accent} style={styles.visitIcon} />
      <View style={styles.visitText}>
        <ThemedText style={styles.visitTitle}>{title}</ThemedText>
        <ThemedText variant="metadata" themeColor="textSecondary">
          {details}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  visitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.compact,
    padding: Spacing.compact,
    borderRadius: Radius.button,
    backgroundColor: Gallery.highlight,
  },
  visitIcon: { width: 20, height: 20 },
  visitText: { flex: 1, gap: Spacing.half },
  visitTitle: { fontWeight: "600" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.content,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.compact,
  },
  heading: { flex: 1 },
  check: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    backgroundColor: Gallery.highlight,
    alignItems: "center",
    justifyContent: "center",
  },
  checkIcon: { width: 18, height: 18 },
  content: { paddingHorizontal: Spacing.content, paddingBottom: Spacing.two, gap: Spacing.two },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingBottom: Spacing.content,
  },
  stacked: { flexDirection: "column", alignItems: "flex-start" },
  thumbnail: { width: 76, height: 76, borderRadius: Radius.thumbnail },
  identity: { flex: 1, gap: Spacing.one },
  noteLabel: { flex: 1 },
  noteSection: { gap: Spacing.two },
  noteTitle: { fontWeight: "600" },
  sharedNotice: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  sharedNoticeIcon: { width: 12, height: 12 },
  actions: { padding: Spacing.content, paddingTop: Spacing.four },
  muted: { color: Gallery.muted },
});
