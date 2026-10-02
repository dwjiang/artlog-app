import { router } from "expo-router";

import { GalleryButton } from "@/components/collection/gallery-button";
import { EmptyState } from "@/components/empty-state";
import { EmptyFrames, EmptyTicket } from "@/components/empty-state-art";

export function CollectionEmptyState({ kind }: { kind: "artworks" | "visits" }) {
  const visits = kind === "visits";
  return (
    <EmptyState
      visual={visits ? <EmptyTicket /> : <EmptyFrames />}
      title={visits ? "No visits yet." : "No saved artworks yet."}
      detail={
        visits
          ? "Add a museum visit to record its date, artworks, and notes."
          : "Scan an artwork to add it to your collection."
      }
      footnote={visits ? "Your visits stay private until you share them." : undefined}
    >
      <GalleryButton
        label={visits ? "Add visit" : "Scan artwork"}
        variant="filled"
        fullWidth
        onPress={() => (visits ? router.push("/visit-create") : router.navigate("/scan"))}
      />
    </EmptyState>
  );
}
