import { reportError } from "@/lib/observability";
import { Image } from "expo-image";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { selectCaptureForScan } from "@/db/repos/pending-scans";
import { useLocalOwner } from "@/lib/account/owner-store";
import { captureFileUri } from "@/lib/files/photos";
import { ListSkeleton } from "@/components/loading-skeleton";
import { router } from "expo-router";
import { EmptyState } from "../empty-state";
import { EmptyPaper } from "../empty-state-art";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useRef, useState } from "react";
import { Alert, FlatList, View } from "react-native";

import { api } from "../../../convex/_generated/api";
import { GalleryButton } from "@/components/collection/gallery-button";
import { ThemedText } from "@/components/themed-text";
import { Gallery, Spacing } from "@/constants/theme";

export type Contribution = FunctionReturnType<typeof api.contributions.mine>[number];

export function ContributionsScreen({
  contributions,
  offline,
}: {
  contributions: Contribution[] | undefined;
  offline: boolean;
}) {
  return (
    <FlatList
      style={{ flex: 1, backgroundColor: Gallery.paper }}
      contentInsetAdjustmentBehavior="automatic"
      data={contributions ?? []}
      keyExtractor={(row) => row.contributionId}
      contentContainerStyle={{ padding: Spacing.content, gap: Spacing.three }}
      renderItem={({ item }) => <ContributionRow contribution={item} />}
      ListHeaderComponent={
        contributions?.length ? (
          <View style={{ gap: Spacing.three }}>
            <ThemedText themeColor="textSecondary">
              Saving a confirmed work shares its label details and a small artwork crop with the index. Your full photos
              stay private. No account needed.
            </ThemedText>
            {!!contributions?.length && (
              <ThemedText type="small" themeColor="textSecondary">
                Contributions from this device, newest first. Up to 200 are shown.
              </ThemedText>
            )}
          </View>
        ) : null
      }
      ListEmptyComponent={
        contributions === undefined ? (
          offline ? (
            <ThemedText themeColor="textSecondary">Connect to see your contributions.</ThemedText>
          ) : (
            <ListSkeleton label="Loading contributions…" rows={3} />
          )
        ) : (
          <EmptyState
            inset={false}
            title="No contributions yet."
            detail="Save a confirmed artwork to share its label details and a small artwork crop with the index."
            visual={<EmptyPaper kind="label" />}
            footnote="Your full photos stay private. No account needed."
          >
            <GalleryButton
              label="Scan artwork"
              variant="filled"
              fullWidth
              onPress={() => {
                router.dismissAll();
                router.navigate("/scan");
              }}
            />
          </EmptyState>
        )
      }
    />
  );
}

function ContributionRow({ contribution }: { contribution: Contribution }) {
  const withdraw = useMutation(api.contributions.withdraw);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string>();
  const [withdrawn, setWithdrawn] = useState(false);
  const removed = withdrawn || contribution.rejectedReason === "withdrawn";
  const status = removed
    ? "Withdrawn"
    : {
        tentative: "Shared · Tentative",
        rejected: "Not added to the index",
      }[contribution.status];

  async function remove() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await withdraw({ contributionId: contribution.contributionId });
      setWithdrawn(true);
    } catch (cause) {
      reportError(cause, "contribution.withdraw");
      setError("Couldn't withdraw this contribution. Check your connection and try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <View
      style={{
        flexDirection: "row",
        gap: 12,
        paddingVertical: 14,
        borderBottomWidth: 0.5,
        borderBottomColor: Gallery.softBorder,
      }}
    >
      {contribution.scanId && <ContributionPhoto scanId={contribution.scanId} />}
      <View style={{ flex: 1, gap: 6 }}>
        <ThemedText type="smallBold">{contribution.fields.title.value}</ThemedText>
        <ThemedText>{contribution.fields.artist.value}</ThemedText>
        <ThemedText
          type="small"
          style={{
            alignSelf: "flex-start",
            paddingHorizontal: 7,
            paddingVertical: 3,
            backgroundColor: removed ? Gallery.fill : Gallery.highlight,
          }}
        >
          {status}
        </ThemedText>
        {!removed && (
          <GalleryButton
            label="Withdraw"
            busy={busy}
            disabled={busy}
            destructive
            onPress={() =>
              Alert.alert(
                "Withdraw this contribution?",
                "This removes your contribution from the shared index. The artwork and photos stay in your collection.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Withdraw",
                    style: "destructive",
                    onPress: () => {
                      void remove();
                    },
                  },
                ],
              )
            }
          />
        )}
        {removed && (
          <ThemedText type="small" themeColor="textSecondary">
            Withdrawn from the index. Your artwork and photos stay in your collection.
          </ThemedText>
        )}
        {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      </View>
    </View>
  );
}

function ContributionPhoto({ scanId }: { scanId: NonNullable<Contribution["scanId"]> }) {
  const owner = useLocalOwner();
  const capture = useLiveQuery(selectCaptureForScan(scanId, owner), [scanId, owner]).data[0];
  return (
    <Image
      source={capture?.cropPath ? { uri: captureFileUri(capture.cropPath) } : "sf:photo"}
      contentFit="contain"
      style={{ width: 64, height: 64, backgroundColor: Gallery.fill }}
    />
  );
}
