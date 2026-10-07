import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { signInRoute } from "@/lib/account/sign-in-context";
import { withPendingLike } from "@/lib/social/presentation";
import type { SharedVisit } from "@/lib/social/types";
import { useSocialQuery } from "@/lib/social/use-social-query";
import { useSocialSession, type SocialSession } from "@/lib/social/use-social-session";
import { showErrorToast } from "@/lib/ui/toast";
import { socialErrorMessage } from "@/shared/social/errors";

import { api } from "../../../convex/_generated/api";
import { LikeHeart, playLikeHaptic } from "./like-heart";
import { ReactionIcon } from "./reaction-icon";
import { TaggedText } from "./tagged-text";
import { VisitReactionsSheet } from "./visit-reactions-sheet";

export type ReactionVisit = Pick<SharedVisit, "postId">;
export type ReactionSummary = FunctionReturnType<typeof api.visitReactions.getSummary>;

export function VisitReactions({ visit, openComments = false }: { visit: ReactionVisit; openComments?: boolean }) {
  const session = useSocialSession();
  return (
    <LiveReactions key={`${session.key}:${visit.postId}`} visit={visit} session={session} openComments={openComments} />
  );
}

function LiveReactions({
  visit,
  session,
  openComments,
}: {
  visit: ReactionVisit;
  session: SocialSession;
  openComments: boolean;
}) {
  const router = useRouter();
  const ready = !session.offline && ["ready", "signed-out", "profile-required"].includes(session.status);
  const summary = useSocialQuery(api.visitReactions.getSummary, ready ? { postId: visit.postId } : "skip", session.key);
  const setLike = useMutation(api.visitReactions.setLike);
  const [sheet, setSheet] = useState<"comments" | "likes" | null>(openComments ? "comments" : null);
  const [likeTarget, setLikeTarget] = useState<boolean>();
  const pending = useRef(false);
  const join = () => {
    setSheet(null);
    router.push(session.status === "profile-required" ? "/create-profile" : signInRoute("reactions"));
  };
  const like = async () => {
    if (session.status === "signed-out" || session.status === "profile-required") {
      join();
      return;
    }
    if (!summary.data || session.status !== "ready" || pending.current) return;
    const liked = !summary.data.liked;
    pending.current = true;
    setLikeTarget(liked);
    if (liked) playLikeHaptic();
    try {
      await setLike({ postId: visit.postId, liked });
    } catch (cause) {
      showErrorToast(socialErrorMessage(cause) ?? "Couldn’t update your like.", () => void like());
    } finally {
      pending.current = false;
      setLikeTarget(undefined);
    }
  };
  return (
    <>
      <VisitReactionRow
        summary={summary.data && withPendingLike(summary.data, likeTarget)}
        busy={likeTarget !== undefined}
        disabled={!ready || !summary.data}
        onLike={() => void like()}
        onComments={() => setSheet("comments")}
        onLikes={() => setSheet("likes")}
      />
      {summary.error && (
        <MotionPressable
          accessibilityRole="button"
          accessibilityLabel="Retry reactions"
          onPress={summary.refresh}
          style={styles.retry}
        >
          <Text accessibilityRole="alert" style={styles.error}>
            Couldn’t load reactions. Tap to retry.
          </Text>
        </MotionPressable>
      )}
      {sheet && (
        <VisitReactionsSheet
          kind={sheet}
          visit={visit}
          summary={summary.data}
          session={session}
          onDismiss={() => setSheet(null)}
          onJoin={join}
        />
      )}
    </>
  );
}

export function VisitReactionRow({
  summary,
  busy = false,
  disabled = false,
  onLike,
  onComments,
  onLikes,
}: {
  summary?: ReactionSummary;
  busy?: boolean;
  disabled?: boolean;
  onLike: () => void;
  onComments: () => void;
  onLikes: () => void;
}) {
  const liked = summary?.liked ?? false;
  const count = summary?.likeCount ?? 0;
  const others = count - 1;
  const latest = summary?.latestComment;
  const viewAll = summary && summary.commentCount > 1 ? `View all ${summary.commentCount} comments` : undefined;
  return (
    <View>
      <View pointerEvents="box-none" style={styles.row}>
        <MotionPressable
          accessibilityRole="button"
          accessibilityLabel={liked ? "Unlike visit" : "Like visit"}
          accessibilityValue={{
            text: summary ? `${count} ${count === 1 ? "like" : "likes"}` : "Loading likes",
          }}
          accessibilityState={{
            selected: liked,
            busy,
            disabled: disabled || busy,
          }}
          disabled={disabled || busy}
          onPress={onLike}
          style={styles.reaction}
        >
          <LikeHeart liked={summary?.liked} />
          <Text style={[styles.count, liked && { color: Gallery.accent }]}>{summary ? count : "–"}</Text>
        </MotionPressable>
        <MotionPressable
          accessibilityRole="button"
          accessibilityLabel={
            summary
              ? `Open ${summary.commentCount} ${summary.commentCount === 1 ? "comment" : "comments"}`
              : "Open comments"
          }
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onComments}
          style={styles.reaction}
        >
          <ReactionIcon kind="comment" />
          <Text style={[styles.count, { fontWeight: "500" }]}>{summary?.commentCount ?? "–"}</Text>
        </MotionPressable>
      </View>
      {!!summary && count > 0 && (
        <MotionPressable
          accessibilityRole="button"
          accessibilityLabel="See who liked this visit"
          onPress={onLikes}
          style={styles.summary}
          hitSlop={{ bottom: 22 }}
        >
          <Text style={styles.summaryText}>
            {liked ? (
              <>
                Liked by <Text style={styles.strong}>you</Text>
                {others > 0 ? (
                  <>
                    {" "}
                    and{" "}
                    <Text style={styles.strong}>
                      {others} {others === 1 ? "other" : "others"}
                    </Text>
                  </>
                ) : (
                  ""
                )}
              </>
            ) : (
              <>
                <Text style={styles.strong}>{count}</Text> {count === 1 ? "person likes" : "people like"} this
              </>
            )}
          </Text>
        </MotionPressable>
      )}
      {latest && (
        <MotionPressable
          accessibilityRole="button"
          accessibilityLabel={`${viewAll ? `${viewAll}. Latest from` : "Open comment from"} ${latest.authorName}: ${latest.body}`}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onComments}
          style={styles.latest}
          hitSlop={{ bottom: 16 }}
        >
          <Text numberOfLines={2} style={styles.latestText}>
            <Text style={styles.strong}>{latest.authorName}</Text>{" "}
            <TaggedText mentions={latest.mentions}>{latest.body}</TaggedText>
          </Text>
          {viewAll && <Text style={styles.viewAll}>{viewAll}</Text>}
        </MotionPressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // The 44-point targets overlap the content above and the like summary below so the icons sit close to both.
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 44,
    marginTop: -3,
    marginBottom: -6,
    zIndex: 1,
    flexWrap: "wrap",
  },
  reaction: {
    minWidth: 44,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  count: {
    color: Gallery.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  summary: { alignSelf: "flex-start", minHeight: 22, paddingTop: 2 },
  summaryText: { color: Gallery.ink, fontSize: 12, lineHeight: 18 },
  strong: { fontWeight: "600" },
  latest: { paddingVertical: 4, gap: 2 },
  latestText: { color: Gallery.ink, fontSize: 13, lineHeight: 18 },
  viewAll: { color: Gallery.muted, fontSize: 12, lineHeight: 18 },
  retry: { minHeight: 44, justifyContent: "center" },
  error: { color: Gallery.destructive, fontSize: 13, lineHeight: 18 },
});
