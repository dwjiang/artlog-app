import { router } from "expo-router";
import { ScrollView } from "react-native";

import { FeedSkeleton } from "@/components/loading-skeleton";
import { convexErrorCode } from "@/lib/network-error";
import { useBlock } from "@/lib/social/use-block";
import { useSocialQuery } from "@/lib/social/use-social-query";
import { useSocialSession, type SocialSession } from "@/lib/social/use-social-session";
import { socialErrorMessage } from "@/shared/social/errors";

import { api } from "../../../convex/_generated/api";
import { SocialGate, SocialState } from "./social-state";
import { socialStyles } from "./social-styles";
import { VisitCard } from "./visit-card";

/** One shared visit as its feed card, where notifications and visit links land. */
export function VisitScreen({ postId, openComments = false }: { postId: string; openComments?: boolean }) {
  const session = useSocialSession();
  return <VisitPost key={`${session.key}:${postId}`} postId={postId} session={session} openComments={openComments} />;
}

function VisitPost({
  postId,
  session,
  openComments,
}: {
  postId: string;
  session: SocialSession;
  openComments: boolean;
}) {
  const blocking = useBlock(session);
  const ready = !session.offline && ["ready", "signed-out", "profile-required"].includes(session.status);
  const visit = useSocialQuery(api.sharedVisits.get, ready && postId ? { postId } : "skip", session.key);
  const unavailable = !postId || convexErrorCode(visit.error) === "not_found";
  return (
    // The card's comments sheet renders in this tree; "handled" lets taps reach its composer.
    <ScrollView
      style={socialStyles.root}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={socialStyles.content}
    >
      {!ready ? (
        <SocialGate session={session} />
      ) : unavailable ? (
        <SocialState
          action="Back to Home"
          onAction={() => {
            router.dismissAll();
            router.navigate("/");
          }}
          title="Visit unavailable."
          detail="This visit is no longer shared with you."
        />
      ) : visit.error ? (
        <SocialState
          title="Couldn’t load this visit."
          detail={socialErrorMessage(visit.error) ?? "Please try again."}
          action="Try again"
          onAction={visit.refresh}
        />
      ) : !visit.data ? (
        <FeedSkeleton label="Loading visit…" />
      ) : (
        <VisitCard
          visit={visit.data}
          token={session.token}
          viewerProfileId={session.profileId}
          openComments={openComments}
          onBlock={session.status === "ready" ? blocking.block : undefined}
        />
      )}
    </ScrollView>
  );
}
