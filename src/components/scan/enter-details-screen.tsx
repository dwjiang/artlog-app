import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { EmptyState } from "@/components/empty-state";
import { FormSkeleton } from "@/components/loading-skeleton";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { useLocalOwner } from "@/lib/account/owner-store";
import { formStateFromValues, setFieldValue, type LabelFormState } from "@/lib/label/fields";
import { useLabelCapture } from "@/lib/label/use-label-capture";
import { selectResultCandidates, type ScanResult } from "@/lib/result/state";
import { useScan } from "@/lib/result/use-scan";

import type { Id } from "../../../convex/_generated/dataModel";
import type { LabelFieldName } from "../../../convex/lib/validators";
import { ConfirmDetailsReview } from "./label/confirm-details-review";

export function EnterDetailsScreen({ scanId }: { scanId: Id<"scans"> }) {
  const owner = useLocalOwner();
  // The router reuses this screen for a new scan id; the key drops the previous scan's form.
  return <EnterDetails key={`${owner}:${scanId}`} scanId={scanId} />;
}

/** Starts from details already confirmed, else the work the scan suggested, else blank. */
function initialForm(scan: NonNullable<ScanResult>): LabelFormState {
  if (scan.confirmed) return formStateFromValues(scan.confirmed.fields);
  const { primary } = selectResultCandidates(scan);
  return formStateFromValues(
    primary && { title: primary.title, artist: primary.artist, date: primary.date, medium: primary.medium },
  );
}

function EnterDetails({ scanId }: { scanId: Id<"scans"> }) {
  const router = useRouter();
  const scan = useScan(scanId);
  const capture = useLabelCapture(scanId);
  const [form, setForm] = useState<LabelFormState>();
  const loaded = scan && !(scan instanceof Error) ? scan : undefined;
  if (!form && loaded) setForm(initialForm(loaded));

  if (scan === undefined || (loaded && !form)) {
    return (
      <ThemedView style={styles.container}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
          <FormSkeleton label="Loading the details…" />
        </ScrollView>
      </ThemedView>
    );
  }
  if (!form) {
    return (
      <ThemedView style={styles.container}>
        <EmptyState title="This scan isn’t available" detail="Go back to the scan and try again.">
          <GalleryButton label="Back" variant="filled" fullWidth onPress={() => router.back()} />
        </EmptyState>
      </ThemedView>
    );
  }
  return (
    <ConfirmDetailsReview
      scanId={scanId}
      sourceKind="manual"
      capture={capture}
      form={form}
      onChange={(name: LabelFieldName, value: string) =>
        setForm((current) => current && setFieldValue(current, name, value))
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.content, gap: Spacing.three },
});
