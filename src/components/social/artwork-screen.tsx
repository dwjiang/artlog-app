import { router } from "expo-router";

import { ArtworkSkeleton } from "@/components/loading-skeleton";
import { SafeAreaScrollView } from "@/components/safe-area-scroll";
import { useScrollTitle } from "@/hooks/use-scroll-title";
import { convexErrorCode } from "@/lib/network-error";
import { useSocialQuery } from "@/lib/social/use-social-query";
import { useSocialSession } from "@/lib/social/use-social-session";
import { socialErrorMessage } from "@/shared/social/errors";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { PublishedArtwork } from "./published-artwork";
import { ReportToolbar } from "./report-toolbar";
import { SocialGate, SocialState } from "./social-state";
import { socialStyles } from "./social-styles";

export function ArtworkScreen({ kind, itemId, postId }: { kind: string; itemId: string; postId?: string }) {
  const session = useSocialSession();
  const shared = kind === "visit";
  const invalid = !itemId || (kind !== "wall" && !shared) || (shared && !postId);
  const sessionReady = ["ready", "signed-out", "profile-required"].includes(session.status);
  const canRead = !invalid && !session.offline && (!shared || sessionReady);
  const wall = useSocialQuery(
    api.walls.getArtwork,
    canRead && !shared ? { itemId: itemId as Id<"wallItems"> } : "skip",
    session.key,
  );
  const visit = useSocialQuery(
    api.sharedVisits.getArtwork,
    canRead && shared ? { itemId: itemId as Id<"sharedVisitItems">, postId: postId! } : "skip",
    session.key,
  );
  const result = shared ? visit : wall;
  const { data } = result;
  const unavailable = invalid || data === null || convexErrorCode(result.error) === "not_found";
  const opening = !session.offline && (!shared || sessionReady) && !unavailable && !result.error && !data;
  const owner = data?.profileId;
  const { scrollRef, headingRef, measureHeading, onScroll } = useScrollTitle(data?.artwork.title ?? "");
  return (
    <>
      {owner && session.status !== "loading" && owner !== session.profileId && (
        <ReportToolbar kind={shared ? "sharedVisit" : "wallItem"} id={shared ? postId! : itemId} />
      )}
      <SafeAreaScrollView
        ref={scrollRef}
        style={socialStyles.root}
        contentInsetAdjustmentBehavior="automatic"
        bounces={!!data}
        scrollEnabled={!opening}
        contentContainerStyle={socialStyles.content}
        onContentSizeChange={measureHeading}
        onScroll={onScroll}
      >
        {session.offline || (shared && !sessionReady) ? (
          <SocialGate session={session} />
        ) : unavailable ? (
          <SocialState
            action="Back to Home"
            onAction={() => {
              router.dismissAll();
              router.navigate("/");
            }}
            title="Artwork unavailable."
            detail="This artwork is no longer shared."
          />
        ) : result.error ? (
          <SocialState
            title="Couldn’t load this artwork."
            detail={socialErrorMessage(result.error) ?? "Please try again."}
            action="Try again"
            onAction={result.refresh}
          />
        ) : !data ? (
          <ArtworkSkeleton />
        ) : (
          <PublishedArtwork
            key={`${session.key}:${itemId}`}
            artwork={data.artwork}
            photos={data.photos ?? []}
            token={session.token}
            enrichment={data.enrichment}
            headingRef={headingRef}
            onHeadingLayout={measureHeading}
          />
        )}
      </SafeAreaScrollView>
    </>
  );
}
