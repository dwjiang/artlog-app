import { TextSkeleton } from "@/components/loading-skeleton";
import { ThemedText as Text } from "@/components/themed-text";
import { api } from "../../../convex/_generated/api";
import { Gallery } from "@/constants/theme";
import { useLocalOwner, useServerScope } from "@/lib/account/owner-store";
import { useSocialQuery } from "@/lib/social/use-social-query";
import { useSocialSession } from "@/lib/social/use-social-session";

export function PhotoVisibility({ savedId, photoId }: { savedId: string; photoId: string }) {
  const owner = useLocalOwner();
  return owner.startsWith("account:") ? (
    <PublishedPhotoVisibility key={`${owner}:${savedId}`} savedId={savedId} photoId={photoId} />
  ) : (
    <VisibilityLabel>This photo is private.</VisibilityLabel>
  );
}

function PublishedPhotoVisibility({ savedId, photoId }: { savedId: string; photoId: string }) {
  const session = useSocialSession(),
    scope = useServerScope();
  const visibility = useSocialQuery(
    api.photoVisibility.forArtwork,
    session.status === "ready" && scope ? { scope, savedLocalId: savedId } : "skip",
    session.key,
  );
  if (session.status === "profile-required") {
    return <VisibilityLabel>This photo is private.</VisibilityLabel>;
  }
  if (session.offline || session.error || visibility.error) {
    return <VisibilityLabel>Photo visibility unavailable. Connect to check where it is shared.</VisibilityLabel>;
  }
  if (session.status !== "ready" || !scope || !visibility.data) {
    return <TextSkeleton label="Checking photo visibility…" width={180} />;
  }
  const photo = visibility.data.find((row) => row.photoLocalId === photoId);
  const wall = photo?.wallPlacements ?? 0,
    visits = photo?.sharedVisits ?? 0;
  const parts = [
    wall ? `${wall} public wall ${wall === 1 ? "placement" : "placements"}` : "",
    visits ? `${visits} shared ${visits === 1 ? "visit" : "visits"}` : "",
  ].filter(Boolean);
  return (
    <VisibilityLabel>
      {parts.length ? `${parts.join(" · ")}. Other photos have their own sharing choices.` : "This photo is private."}
    </VisibilityLabel>
  );
}

function VisibilityLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text selectable style={{ color: Gallery.muted, fontSize: 13, lineHeight: 18 }}>
      {children}
    </Text>
  );
}
