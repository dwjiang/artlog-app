import { BottomSheet, RNHostView } from "@expo/ui";
import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { setStringAsync } from "expo-clipboard";
import { randomUUID } from "expo-crypto";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { Fragment, useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { ActionSheetIOS, Alert, ScrollView, StyleSheet, TextInput, View, type ScrollViewProps } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { GalleryIconButton } from "@/components/collection/gallery-icon-button";
import { LoadingRing } from "@/components/loading-ring";
import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText as Text } from "@/components/themed-text";
import { ToastLayer } from "@/components/toast";
import { VisitSymbol } from "@/components/visits/visit-ui";
import { Gallery } from "@/constants/theme";
import { reportError } from "@/lib/observability";
import { formatRelativeTime } from "@/lib/queue/relative-time";
import { reportHref } from "@/lib/social/report";
import type { PublicProfile } from "@/lib/social/types";
import { useBlock } from "@/lib/social/use-block";
import { useCursorPages, useSocialQuery } from "@/lib/social/use-social-query";
import type { SocialSession } from "@/lib/social/use-social-session";
import { showErrorToast, showToast } from "@/lib/ui/toast";
import { socialErrorMessage } from "@/shared/social/errors";
import { MAX_COMMENT_LENGTH } from "@/shared/social/visit-reactions";

import { api } from "../../../convex/_generated/api";
import { ProfileAvatar } from "./profile-avatar";
import { ReactionIcon } from "./reaction-icon";
import { PageFooter } from "./social-state";
import type { ReactionSummary, ReactionVisit } from "./visit-reactions";

type CommentPage = FunctionReturnType<typeof api.visitReactions.listComments>;
type Comment = CommentPage["page"][number];
const commentsPage = (value: CommentPage) => value;
const commentId = (value: Comment) => value.commentId;
const likesPage = (value: FunctionReturnType<typeof api.visitReactions.listLikes>) => value;
const profileId = (value: PublicProfile) => value.profileId;
type CommentAction = { name: string; label: string; destructive?: boolean; run: () => void };

const COMMENT_AUDIENCE = {
  private: "Only you can see this visit and its comments.",
  friends: "Only friends can see comments, like this visit.",
  public: "Comments are public, like this visit.",
} as const;

export function VisitReactionsSheet({
  kind,
  visit,
  summary,
  session,
  onDismiss,
  onJoin,
}: {
  kind: "comments" | "likes";
  visit: ReactionVisit;
  summary?: ReactionSummary;
  session: SocialSession;
  onDismiss: () => void;
  onJoin: () => void;
}) {
  const title = kind === "comments" ? "Comments" : "Likes";
  // Hosted content lays out at its own height, and flex children there don't follow the sheet as it resizes, so the
  // list takes an explicit height: the sheet's measured height (which already excludes the keyboard) minus the heading.
  const [sheetHeight, setSheetHeight] = useState<number>();
  const [headingHeight, setHeadingHeight] = useState(0);
  const listSpace = sheetHeight === undefined ? undefined : sheetHeight - headingHeight;
  return (
    <BottomSheet
      isPresented
      onDismiss={onDismiss}
      snapPoints={[{ fraction: 0.78 }, "full"]}
      containerColor={Gallery.paper}
      contentPadding={{ top: 16, left: 0, right: 0, bottom: 0 }}
    >
      <RNHostView onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}>
        <View style={styles.sheet}>
          <View style={styles.heading} onLayout={(event) => setHeadingHeight(event.nativeEvent.layout.height)}>
            <View style={{ width: 44 }} />
            <Text accessibilityRole="header" style={styles.title}>
              {title}{" "}
              <Text style={styles.total}>
                {summary ? (kind === "comments" ? summary.commentCount : summary.likeCount) : ""}
              </Text>
            </Text>
            <GalleryIconButton label={`Close ${kind}`} icon="xmark" onPress={onDismiss} />
          </View>
          {kind === "comments" ? (
            <Comments visit={visit} session={session} height={listSpace} onJoin={onJoin} onDismiss={onDismiss} />
          ) : (
            <Likes postId={visit.postId} session={session} height={listSpace} onDismiss={onDismiss} />
          )}
          <ToastLayer offset={0} />
        </View>
      </RNHostView>
    </BottomSheet>
  );
}

function Likes({
  postId,
  session,
  height,
  onDismiss,
}: {
  postId: string;
  session: SocialSession;
  height?: number;
  onDismiss: () => void;
}) {
  const router = useRouter();
  const likes = useCursorPages(api.visitReactions.listLikes, { postId }, session.key, likesPage, profileId);
  return (
    <SheetList
      items={likes.items}
      itemKey={profileId}
      height={height}
      onEndReached={likes.loadMore}
      renderItem={(item) => (
        <MotionPressable
          accessibilityRole="button"
          accessibilityLabel={`View ${item.name}’s profile`}
          style={styles.person}
          onPress={() => {
            onDismiss();
            router.push({
              pathname: "/profile/[profileId]",
              params: { profileId: item.profileId },
            });
          }}
        >
          <ProfileAvatar name={item.name} photoUrl={item.photoUrl} avatar={item.avatar} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.meta}>@{item.username}</Text>
          </View>
        </MotionPressable>
      )}
      empty={likes.done && !likes.loading && !likes.error ? <Empty title="No likes yet." /> : null}
      footer={
        !likes.done || likes.loading || likes.error ? (
          <PageFooter {...likes} count={likes.items.length} noun="likes" />
        ) : null
      }
    />
  );
}

function Comments({
  visit,
  session,
  height,
  onJoin,
  onDismiss,
}: {
  visit: ReactionVisit;
  session: SocialSession;
  height?: number;
  onJoin: () => void;
  onDismiss: () => void;
}) {
  const router = useRouter();
  const comments = useCursorPages(
    api.visitReactions.listComments,
    { postId: visit.postId },
    session.key,
    commentsPage,
    commentId,
  );
  const viewer = useSocialQuery(api.profiles.mine, session.status === "ready" ? {} : "skip", session.key);
  const addComment = useAction(api.visitReactions.addComment);
  const deleteComment = useMutation(api.visitReactions.deleteComment);
  const setCommentLike = useMutation(api.visitReactions.setCommentLike);
  const blocking = useBlock(session);
  const list = useRef<ScrollView>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const pending = useRef(false);
  const request = useRef<{ body: string; id: string } | null>(null);
  const [posted, setPosted] = useState<string>();
  const [deleting, setDeleting] = useState<string>();
  const [error, setError] = useState<string>();
  const [menuFor, setMenuFor] = useState<string>();
  const [composerHeight, setComposerHeight] = useState(0);
  // The heart shows the requested state until the write settles, so a tap answers at once and a failure falls back.
  const likeRequests = useRef(new Map<string, boolean>());
  const [likeTargets, setLikeTargets] = useState<ReadonlyMap<string, boolean>>(new Map());
  const { canLoadMore, loadMore } = comments;
  const postedVisible = !!posted && comments.items.some((item) => item.commentId === posted);
  useEffect(() => {
    if (posted && !postedVisible && canLoadMore) loadMore();
  }, [posted, postedVisible, canLoadMore, loadMore]);
  // The live list usually delivers a new comment before its mutation returns, so the reveal waits for both.
  const [reveals, setReveals] = useState(0);
  if (postedVisible) {
    setPosted(undefined);
    setReveals((count) => count + 1);
  }
  useEffect(() => {
    if (reveals > 0) list.current?.scrollToEnd({ animated: true });
  }, [reveals]);
  const send = async () => {
    const body = draft.trim();
    if (!body || pending.current || session.status !== "ready") return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    if (request.current?.body !== body) {
      request.current = { body, id: randomUUID() };
    }
    try {
      const id = await addComment({
        postId: visit.postId,
        body,
        requestId: request.current.id,
      });
      setDraft("");
      request.current = null;
      setPosted(id);
    } catch (cause) {
      setError(socialErrorMessage(cause) ?? "Couldn’t post your comment. Your text is still here.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const remove = (item: Comment) =>
    Alert.alert("Delete comment?", "This removes your comment from this visit.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          if (pending.current) return;
          pending.current = true;
          setDeleting(item.commentId);
          setError(undefined);
          try {
            await deleteComment({
              postId: visit.postId,
              commentId: item.commentId,
            });
          } catch (cause) {
            setError(socialErrorMessage(cause) ?? "Couldn’t delete your comment. Try again.");
          } finally {
            pending.current = false;
            setDeleting(undefined);
          }
        },
      },
    ]);
  const toggleLike = async (item: Comment) => {
    if (session.status === "signed-out" || session.status === "profile-required") {
      onJoin();
      return;
    }
    if (session.status !== "ready" || likeRequests.current.has(item.commentId)) return;
    likeRequests.current.set(item.commentId, !item.liked);
    setLikeTargets(new Map(likeRequests.current));
    try {
      await setCommentLike({ postId: visit.postId, commentId: item.commentId, liked: !item.liked });
    } catch (cause) {
      showErrorToast(socialErrorMessage(cause) ?? "Couldn’t update your like.", () => void toggleLike(item));
    } finally {
      likeRequests.current.delete(item.commentId);
      setLikeTargets(new Map(likeRequests.current));
    }
  };
  const copy = async (item: Comment) => {
    try {
      if (await setStringAsync(item.body)) showToast("Comment copied.");
      else showErrorToast("Couldn’t copy the comment.");
    } catch (cause) {
      reportError(cause, "social.comment.copy", { level: "warning" });
      showErrorToast("Couldn’t copy the comment.");
    }
  };
  const actionsFor = (item: Comment): CommentAction[] => [
    { name: "copy", label: "Copy comment", run: () => void copy(item) },
    ...(session.profileId === item.author.profileId
      ? [{ name: "delete", label: "Delete comment", destructive: true, run: () => remove(item) }]
      : session.status === "loading"
        ? []
        : [
            {
              name: "report",
              label: "Report comment",
              run: () => {
                // A route sheet can’t present over this native sheet, so this one closes first.
                onDismiss();
                router.push(reportHref("comment", item.commentId));
              },
            },
            ...(session.status === "ready"
              ? [
                  {
                    name: "block",
                    label: `Block ${item.author.name}`,
                    destructive: true,
                    run: () => blocking.block(item.author),
                  },
                ]
              : []),
          ]),
  ];
  const showActions = (item: Comment) => {
    const actions = actionsFor(item);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setMenuFor(item.commentId);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...actions.map((action) => action.label), "Cancel"],
        cancelButtonIndex: actions.length,
        destructiveButtonIndex: actions.flatMap((action, index) => (action.destructive ? [index] : [])),
      },
      (index) => {
        setMenuFor(undefined);
        actions[index]?.run();
      },
    );
  };
  return (
    <>
      <SheetList
        ref={list}
        items={comments.items}
        itemKey={commentId}
        height={height === undefined ? undefined : height - composerHeight}
        onEndReached={comments.loadMore}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        renderItem={(item) => {
          const time =
            now - item.createdAt < 86_400_000
              ? formatRelativeTime(item.createdAt, now)
              : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(item.createdAt);
          const actions = actionsFor(item);
          const target = likeTargets.get(item.commentId);
          const liked = target ?? item.liked;
          const likeCount = item.likeCount + (target === undefined || target === item.liked ? 0 : target ? 1 : -1);
          return (
            <View
              style={[
                styles.comment,
                menuFor === item.commentId && { backgroundColor: Gallery.fill },
                deleting === item.commentId && { opacity: 0.5 },
              ]}
            >
              <MotionPressable
                accessibilityLabel={`${item.author.name}${item.isAuthor ? ", author" : ""}, ${time}: ${item.body}`}
                accessibilityState={{ busy: deleting === item.commentId }}
                accessibilityActions={actions.map(({ name, label }) => ({ name, label }))}
                onAccessibilityAction={({ nativeEvent }) =>
                  actions.find((action) => action.name === nativeEvent.actionName)?.run()
                }
                onLongPress={() => showActions(item)}
                style={styles.commentContent}
              >
                <ProfileAvatar
                  name={item.author.name}
                  photoUrl={item.author.photoUrl}
                  avatar={item.author.avatar}
                  size={28}
                />
                <View style={{ flex: 1 }}>
                  <View style={styles.byline}>
                    <Text style={styles.name}>{item.author.name}</Text>
                    {item.isAuthor && <Text style={styles.author}>Author</Text>}
                    <Text style={styles.meta}>{time}</Text>
                  </View>
                  <Text style={styles.body}>{item.body}</Text>
                </View>
              </MotionPressable>
              <MotionPressable
                accessibilityRole="button"
                accessibilityLabel={`${liked ? "Unlike" : "Like"} ${item.author.name}’s comment`}
                accessibilityValue={{ text: `${likeCount} ${likeCount === 1 ? "like" : "likes"}` }}
                accessibilityState={{
                  selected: liked,
                  busy: target !== undefined,
                  disabled: target !== undefined || session.status === "loading",
                }}
                disabled={target !== undefined || session.status === "loading"}
                onPress={() => void toggleLike(item)}
                style={styles.commentLike}
              >
                <ReactionIcon kind="heart" filled={liked} size={16} color={Gallery.muted} />
                {likeCount > 0 && (
                  <Text style={[styles.likeCount, liked && { color: Gallery.accent }]}>{likeCount}</Text>
                )}
              </MotionPressable>
            </View>
          );
        }}
        empty={comments.done && !comments.loading && !comments.error ? <Empty title="No comments yet." /> : null}
        footer={
          !comments.done || comments.loading || comments.error ? (
            <PageFooter {...comments} count={comments.items.length} noun="comments" />
          ) : null
        }
      />
      <View style={styles.composer} onLayout={(event) => setComposerHeight(event.nativeEvent.layout.height)}>
        {error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        {session.status === "ready" ? (
          <>
            <View style={styles.inputRow}>
              <ProfileAvatar
                name={viewer.data?.name ?? "You"}
                photoUrl={viewer.data?.photoUrl}
                avatar={viewer.data?.avatar}
                size={28}
              />
              <View style={[styles.inputWrap, focused && { borderColor: Gallery.accent }]}>
                <TextInput
                  accessibilityLabel="Add a comment"
                  placeholder="Add a comment…"
                  placeholderTextColor={Gallery.muted}
                  value={draft}
                  onChangeText={setDraft}
                  editable={!busy}
                  multiline
                  maxLength={MAX_COMMENT_LENGTH}
                  style={styles.input}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                />
                <MotionPressable
                  accessibilityRole="button"
                  accessibilityLabel={busy ? "Posting comment" : "Post comment"}
                  accessibilityState={{
                    disabled: !draft.trim() || busy || !!deleting,
                    busy,
                  }}
                  disabled={!draft.trim() || busy || !!deleting}
                  onPress={() => void send()}
                  style={styles.sendTarget}
                >
                  <View
                    style={[
                      styles.send,
                      (!draft.trim() || busy) && {
                        backgroundColor: Gallery.fill,
                      },
                    ]}
                  >
                    {busy ? (
                      <LoadingRing accessibilityLabel="Posting comment" size={18} />
                    ) : (
                      <VisitSymbol name="arrow.up" size={18} color={draft.trim() ? Gallery.surface : Gallery.muted} />
                    )}
                  </View>
                </MotionPressable>
              </View>
            </View>
            <Text style={styles.audience}>{COMMENT_AUDIENCE[visit.audience]}</Text>
          </>
        ) : (
          <View style={styles.join}>
            <Text style={[styles.body, { flex: 1 }]}>
              {session.status === "profile-required" ? "Create a profile to comment." : "Sign in to comment."}
            </Text>
            <GalleryButton
              label={session.status === "profile-required" ? "Create profile" : "Sign in"}
              onPress={onJoin}
            />
          </View>
        )}
      </View>
    </>
  );
}

// A FlatList never scrolls inside the hosted sheet, so each list keeps its loaded pages in a ScrollView and asks for
// the next page when the reader nears the end, or when the pages so far don't fill the list.
function SheetList<T>({
  items,
  itemKey,
  renderItem,
  empty,
  footer,
  height,
  onEndReached,
  ref,
  ...scroll
}: {
  items: T[];
  itemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  empty: ReactNode;
  footer: ReactNode;
  height?: number;
  onEndReached: () => void;
  ref?: Ref<ScrollView>;
} & Pick<ScrollViewProps, "keyboardShouldPersistTaps" | "keyboardDismissMode">) {
  const nearEnd = (visible: number, offset: number, content: number) => offset + visible * 1.4 >= content;
  return (
    <ScrollView
      {...scroll}
      ref={ref}
      style={height !== undefined && { height }}
      scrollEventThrottle={100}
      onScroll={({ nativeEvent }) => {
        if (
          nearEnd(nativeEvent.layoutMeasurement.height, nativeEvent.contentOffset.y, nativeEvent.contentSize.height)
        ) {
          onEndReached();
        }
      }}
      onContentSizeChange={(_width, content) => {
        if (height !== undefined && nearEnd(height, 0, content)) onEndReached();
      }}
    >
      {items.length === 0 ? empty : items.map((item) => <Fragment key={itemKey(item)}>{renderItem(item)}</Fragment>)}
      {footer}
    </ScrollView>
  );
}

function Empty({ title }: { title: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.name}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: Gallery.paper },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    minHeight: 48,
  },
  title: {
    flex: 1,
    textAlign: "center",
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "600",
  },
  total: { color: Gallery.muted, fontWeight: "400", fontSize: 13 },
  // These lists ignore contentContainerStyle inside the native sheet's RN host, so each row carries the inset.
  person: {
    marginHorizontal: 20,
    minHeight: 69,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: Gallery.softBorder,
  },
  comment: { flexDirection: "row", alignItems: "flex-start", paddingLeft: 20, paddingRight: 8 },
  commentContent: { flex: 1, flexDirection: "row", gap: 10, paddingVertical: 8 },
  byline: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: 6,
    rowGap: 2,
  },
  name: { fontSize: 13, lineHeight: 18, fontWeight: "600", color: Gallery.ink },
  author: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "600",
    color: Gallery.accent,
    backgroundColor: Gallery.highlight,
    borderRadius: 4,
    overflow: "hidden",
    paddingHorizontal: 5,
  },
  meta: { fontSize: 12, lineHeight: 18, color: Gallery.muted },
  body: { fontSize: 14, lineHeight: 19, color: Gallery.ink },
  // Centers the heart and count on the name line and first body line: row padding 8 + (name line 18 + body line 19) / 2
  // − (heart 16 + gap 1 + count 13) / 2. That ends at 41.5, inside a one-line comment's 53, so a first like never grows it.
  commentLike: { width: 44, minHeight: 44, paddingTop: 11.5, alignItems: "center", gap: 1 },
  likeCount: { fontSize: 11, lineHeight: 13, color: Gallery.muted },
  empty: {
    flex: 1,
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  composer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: Gallery.separator,
  },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  inputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    paddingLeft: 11,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Gallery.controlBorder,
    backgroundColor: Gallery.surface,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    fontSize: 13,
    lineHeight: 18,
    paddingTop: 13,
    paddingBottom: 13,
    color: Gallery.ink,
  },
  sendTarget: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  send: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Gallery.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  audience: {
    fontSize: 10,
    lineHeight: 16,
    color: Gallery.muted,
    marginLeft: 37,
  },
  join: { flexDirection: "row", alignItems: "center", gap: 12 },
  error: { fontSize: 13, lineHeight: 19, color: Gallery.destructive },
});
