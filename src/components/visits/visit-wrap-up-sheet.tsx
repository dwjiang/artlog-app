import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { ActionStack } from "@/components/action-stack";
import { GalleryButton } from "@/components/collection/gallery-button";
import { LoadingRing } from "@/components/loading-ring";
import { SafeAreaScrollView } from "@/components/safe-area-scroll";
import { ThemedText } from "@/components/themed-text";
import { Colors, Spacing } from "@/constants/theme";
import { useFittedFormSheetStyle } from "@/hooks/use-fitted-sheet";
import { captureOwner } from "@/lib/account/owner-store";
import { formatElapsed, formatVisitDate } from "@/lib/journal/history";
import { useVisits } from "@/lib/journal/use-visits";
import { saveVisitVisibility } from "@/lib/journal/visit-visibility";
import { clearWrapUp } from "@/lib/journal/wrap-up";
import { reportError } from "@/lib/observability";
import { showToast } from "@/lib/ui/toast";
import { calendarDate } from "@/shared/journal/limits";

import { VisitNotes, type VisitNotesHandle } from "./visit-notes";
import { ArtworkPreviews } from "./visit-ui";

const DAY = 24 * 60 * 60 * 1000;

/**
 * The review Home offers for a visit the app closed after its museum day: a note, then share it or keep it private.
 * Skipping leaves the visit as it is; every exit clears the pending wrap-up so the sheet does not come back.
 */
export function VisitWrapUpSheet() {
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const { owner, visits, loading, error } = useVisits();
  const visit = visits.find((row) => row.localId === visitId);
  const sheetStyle = [styles.container, useFittedFormSheetStyle()];
  const notes = useRef<VisitNotesHandle>(null);
  const submitting = useRef(false);
  const mounted = useRef(false);
  const [busy, setBusy] = useState<"share" | "keep">();
  const [failure, setFailure] = useState<string>();
  const [openedAt] = useState(Date.now);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void clearWrapUp(owner, visitId).catch((cause: unknown) => {
        reportError(cause, "visit.wrap-up.clear", { level: "warning" });
      });
    };
  }, [owner, visitId]);

  function dismiss() {
    void clearWrapUp(owner, visitId).catch((cause: unknown) => {
      reportError(cause, "visit.wrap-up.clear", { level: "warning" });
    });
    router.back();
  }

  async function finish(share: boolean) {
    const session = captureOwner();
    const current = () => mounted.current && session.isCurrent();
    if (!visit || submitting.current || session.owner !== owner) return;
    submitting.current = true;
    setBusy(share ? "share" : "keep");
    setFailure(undefined);
    let savingVisibility = false;
    try {
      if (!(await notes.current?.save()) || !current()) return;
      if (!share && (visit.visibility !== "private" || (owner.startsWith("account:") && visit.syncedAt === null))) {
        savingVisibility = true;
        await saveVisitVisibility(visit, "private");
        savingVisibility = false;
        if (!current()) return;
      }
      await clearWrapUp(owner, visitId);
      if (!current()) return;
      if (share) {
        router.replace({ pathname: "/visit-share/[visitId]", params: { visitId: visit.localId, audience: "friends" } });
      } else {
        showToast("Visit saved.");
        router.back();
      }
    } catch (cause) {
      reportError(cause, "visit.wrap-up.save");
      if (mounted.current && session.isOwnerCurrent()) {
        setFailure(
          savingVisibility && owner.startsWith("account:")
            ? "Visibility could not sync. A published visit may keep its previous visibility. Try again."
            : "Couldn’t save the visit. Try again.",
        );
      }
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(undefined);
    }
  }

  if (!visit) {
    return (
      <ScrollView style={sheetStyle} contentContainerStyle={styles.content} bounces={false}>
        {loading && !error ? (
          <LoadingRing accessibilityLabel="Loading visit" />
        ) : (
          <>
            <ThemedText>{error ? "This visit could not load." : "This visit is unavailable."}</ThemedText>
            <GalleryButton label="Done" fullWidth onPress={dismiss} />
          </>
        )}
      </ScrollView>
    );
  }
  const count = visit.works.length;
  const when =
    visit.visitedOn === calendarDate(openedAt - DAY, visit.timeZone) ? "Yesterday" : formatVisitDate(visit.visitedOn);
  const meta = [
    when,
    `${count} ${count === 1 ? "artwork" : "artworks"}`,
    visit.startedAt !== null && visit.endedAt !== null ? formatElapsed(visit.endedAt - visit.startedAt) : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <SafeAreaScrollView
      style={sheetStyle}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      bounces={false}
    >
      <View style={styles.header}>
        <ThemedText type="subtitle" accessibilityRole="header" style={styles.title}>
          Wrap up your visit?
        </ThemedText>
        <GalleryButton label="Skip" disabled={!!busy} onPress={dismiss} />
      </View>
      <View style={styles.summary}>
        <ThemedText style={styles.venue}>{visit.venueName}</ThemedText>
        <ThemedText variant="metadata" themeColor="textSecondary">
          {meta}
        </ThemedText>
      </View>
      {count > 0 && <ArtworkPreviews works={visit.works} size={56} overflow />}
      <VisitNotes ref={notes} visit={visit} autoSave={false} editable={!busy} />
      {failure && (
        <ThemedText themeColor="error" accessibilityRole="alert">
          {failure}
        </ThemedText>
      )}
      <ActionStack>
        <GalleryButton
          label="Share with friends"
          icon="square.and.arrow.up"
          variant="filled"
          fullWidth
          disabled={busy === "keep"}
          busy={busy === "share"}
          busyLabel="Saving…"
          onPress={() => void finish(true)}
        />
        <GalleryButton
          label="Keep it private"
          variant="outlined"
          fullWidth
          disabled={busy === "share"}
          busy={busy === "keep"}
          busyLabel="Saving…"
          onPress={() => void finish(false)}
        />
      </ActionStack>
    </SafeAreaScrollView>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: Colors.light.background },
  content: { padding: Spacing.content, paddingTop: Spacing.four, gap: Spacing.three },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: Spacing.two },
  title: { flex: 1 },
  summary: { gap: Spacing.half },
  venue: { fontWeight: "600" },
});
