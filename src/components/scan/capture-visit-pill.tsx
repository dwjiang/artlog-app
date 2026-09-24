import { TextSkeleton } from "@/components/loading-skeleton";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { router } from "expo-router";
import { Pressable } from "react-native";
import { listVisits } from "@/db/repos/visits";
import { useLocalOwner } from "@/lib/account/owner-store";
import { GlassSurface } from "../glass-surface";
import { ThemedText } from "../themed-text";

export function CaptureVisitPill({ visitId }: { visitId: string }) {
  const owner = useLocalOwner();
  const visits = useLiveQuery(listVisits(owner), [owner]);
  const visit = visits.data.find(
    (row) => row.owner === owner && row.localId === visitId,
  );
  const label = visit
    ? `Adding to ${visit.venueName}`
    : "Adding to selected visit";
  return (
    <GlassSurface
      isInteractive
      style={{ flexShrink: 1, borderRadius: 24, overflow: "hidden" }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Opens this visit"
        onPress={() =>
          router.push({ pathname: "/journal/[visitId]", params: { visitId } })
        }
        style={{
          minHeight: 44,
          justifyContent: "center",
          paddingHorizontal: 16,
          paddingVertical: 10,
        }}
      >
        {!visits.updatedAt && !visits.error ? (
          <TextSkeleton label="Loading selected visit" width={180} />
        ) : (
          <ThemedText type="smallBold" themeColor="overlayText">
            {label}
          </ThemedText>
        )}
      </Pressable>
    </GlassSurface>
  );
}
