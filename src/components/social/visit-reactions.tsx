import { useMutation } from "convex/react";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { api } from "../../../convex/_generated/api";
import { Gallery } from "@/constants/theme";
import { signInRoute } from "@/lib/account/sign-in-context";
import type { SharedVisit } from "@/lib/social/types";
import { useSocialQuery } from "@/lib/social/use-social-query";
import {
  useSocialSession,
  type SocialSession,
} from "@/lib/social/use-social-session";
import { socialErrorMessage } from "@/shared/social/errors";
import { ThemedText as Text } from "../themed-text";
import { VisitSymbol } from "../visits/visit-ui";
import { VisitReactionsSheet } from "./visit-reactions-sheet";

export type ReactionVisit = Pick<
  SharedVisit,
  "postId" | "author" | "venue" | "visitedOn"
> & {
  media?: SharedVisit["artworks"]["page"][number]["artwork"]["media"];
};
export type ReactionSummary = {
  likeCount: number;
  commentCount: number;
  liked: boolean;
};

const reactionPaths = {
  heart:
    "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
  comment:
    "M21 11.5a9 9 0 0 1-9 9 10 10 0 0 1-4.1-.9L3 21l1.4-4.7A9 9 0 1 1 21 11.5Z",
};
function ReactionIcon({
  kind,
  filled = false,
}: {
  kind: keyof typeof reactionPaths;
  filled?: boolean;
}) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${reactionPaths[kind]}" fill="${filled ? "black" : "none"}" stroke="black" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return (
    <Image
      source={{ uri: `data:image/svg+xml,${encodeURIComponent(svg)}` }}
      tintColor={filled ? Gallery.accent : Gallery.ink}
      accessible={false}
      style={{ width: 22, height: 22 }}
    />
  );
}

export function VisitReactions({
  visit,
  onOpenVisit,
}: {
  visit: ReactionVisit;
  onOpenVisit?: () => void;
}) {
  const session = useSocialSession();
  return (
    <LiveReactions
      key={`${session.key}:${visit.postId}`}
      visit={visit}
      session={session}
      onOpenVisit={onOpenVisit}
    />
  );
}

function LiveReactions({
  visit,
  session,
  onOpenVisit,
}: {
  visit: ReactionVisit;
  session: SocialSession;
  onOpenVisit?: () => void;
}) {
  const router = useRouter();
  const ready =
    !session.offline
    && ["ready", "signed-out", "profile-required"].includes(session.status);
  const summary = useSocialQuery(
    api.visitReactions.getSummary,
    ready ? { postId: visit.postId } : "skip",
    session.key,
  );
  const setLike = useMutation(api.visitReactions.setLike);
  const [sheet, setSheet] = useState<"comments" | "likes" | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string>();
  const join = () => {
    setSheet(null);
    router.push(
      session.status === "profile-required"
        ? "/create-profile"
        : signInRoute("reactions"),
    );
  };
  const like = async () => {
    if (
      session.status === "signed-out"
      || session.status === "profile-required"
    ) {
      join();
      return;
    }
    if (!summary.data || session.status !== "ready" || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await setLike({ postId: visit.postId, liked: !summary.data.liked });
    } catch (cause) {
      setError(
        socialErrorMessage(cause) ?? "Couldn’t update your like. Try again.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <VisitReactionRow
        summary={summary.data}
        busy={busy}
        disabled={!ready || !summary.data}
        onLike={() => void like()}
        onComments={() => setSheet("comments")}
        onLikes={() => setSheet("likes")}
        onOpenVisit={onOpenVisit}
      />
      {(error || summary.error) && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry reactions"
          onPress={summary.error ? summary.refresh : () => void like()}
          style={styles.retry}
        >
          <Text accessibilityRole="alert" style={styles.error}>
            {error ?? "Couldn’t load reactions. Tap to retry."}
          </Text>
        </Pressable>
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
  onOpenVisit,
}: {
  summary?: ReactionSummary;
  busy?: boolean;
  disabled?: boolean;
  onLike: () => void;
  onComments: () => void;
  onLikes: () => void;
  onOpenVisit?: () => void;
}) {
  const liked = summary?.liked ?? false;
  const count = summary?.likeCount ?? 0;
  const others = count - 1;
  return (
    <View>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={liked ? "Unlike visit" : "Like visit"}
          accessibilityValue={{
            text: summary
              ? `${count} ${count === 1 ? "like" : "likes"}`
              : "Loading likes",
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
          <ReactionIcon kind="heart" filled={liked} />
          <Text style={[styles.count, liked && { color: Gallery.accent }]}>
            {summary ? count : "–"}
          </Text>
        </Pressable>
        <Pressable
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
          <Text style={[styles.count, { fontWeight: "500" }]}>
            {summary?.commentCount ?? "–"}
          </Text>
        </Pressable>
        {onOpenVisit && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View visit"
            onPress={onOpenVisit}
            style={styles.visit}
          >
            <Text style={styles.link}>View visit</Text>
            <VisitSymbol name="arrow.right" size={15} color={Gallery.accent} />
          </Pressable>
        )}
      </View>
      {!!summary && count > 0 && (
        <Pressable
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
                <Text style={styles.strong}>{count}</Text>{" "}
                {count === 1 ? "person likes" : "people like"} this
              </>
            )}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 44,
    flexWrap: "wrap",
  },
  reaction: {
    minWidth: 44,
    minHeight: 44,
    paddingTop: 4,
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
  visit: {
    marginLeft: "auto",
    minHeight: 44,
    paddingTop: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  link: {
    color: Gallery.accent,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
  },
  summary: { alignSelf: "flex-start", minHeight: 22, paddingTop: 2 },
  summaryText: { color: Gallery.ink, fontSize: 12, lineHeight: 18 },
  strong: { fontWeight: "600" },
  retry: { minHeight: 44, justifyContent: "center" },
  error: { color: Gallery.destructive, fontSize: 13, lineHeight: 18 },
});
