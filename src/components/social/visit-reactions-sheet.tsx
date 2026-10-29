import { BottomSheet, RNHostView } from "@expo/ui";
import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { setStringAsync } from "expo-clipboard";
import { randomUUID } from "expo-crypto";
import { useRouter } from "expo-router";
import { Fragment, useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import {
  ActionSheetIOS,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type ScrollViewProps,
  type ScrollViewInstance,
  type TextInputInstance,
} from "react-native";
import Animated, { Easing, Keyframe, ReduceMotion } from "react-native-reanimated";

import { GalleryButton } from "@/components/collection/gallery-button";
import { LoadingRing } from "@/components/loading-ring";
import { MotionPressable } from "@/components/motion-pressable";
import { CloseButton } from "@/components/sheet-controls";
import { ThemedText as Text } from "@/components/themed-text";
import { ToastLayer } from "@/components/toast";
import { VisitSymbol } from "@/components/visits/visit-ui";
import { Gallery, PinnedFooterBorder } from "@/constants/theme";
import { reportError } from "@/lib/observability";
import { formatRelativeTime } from "@/lib/queue/relative-time";
import { withPendingLike } from "@/lib/social/presentation";
import { reportHref } from "@/lib/social/report";
import { useSafetyChecks } from "@/lib/social/safety-checks";
import type { PublicProfile } from "@/lib/social/types";
import { useBlock } from "@/lib/social/use-block";
import { useCursorPages, useSocialQuery } from "@/lib/social/use-social-query";
import type { SocialSession } from "@/lib/social/use-social-session";
import { playErrorHaptic, playMediumHaptic, playSuccessHaptic, playToggleHaptic } from "@/lib/ui/haptics";
import { showErrorToast, showToast } from "@/lib/ui/toast";
import { socialErrorMessage } from "@/shared/social/errors";
import { extractHashtags } from "@/shared/social/hashtags";
import { MAX_COMMENT_LENGTH } from "@/shared/social/visit-reactions";

import { api } from "../../../convex/_generated/api";
import { LikeHeart } from "./like-heart";
import { ProfileAvatar } from "./profile-avatar";
import { ProfileRow } from "./profile-row";
import { useRichTextInput } from "./rich-text-input";
import { PageFooter } from "./social-state";
import { profileHref, TaggedText, tagHref, TextLink } from "./tagged-text";
import type { ReactionSummary, ReactionVisit } from "./visit-reactions";

type CommentPage = FunctionReturnType<typeof api.visitReactions.listComments>;
type Comment = CommentPage["page"][number];
const commentsPage = (value: CommentPage) => value;
const commentId = (value: Comment) => value.commentId;
const likesPage = (value: FunctionReturnType<typeof api.visitReactions.listLikes>) => value;
const profileId = (value: PublicProfile) => value.profileId;
type CommentAction = { name: string; label: string; destructive?: boolean; run: () => void };
// A fade rather than motion, so it plays with Reduce Motion on too.
const REVEAL_HIGHLIGHT = new Keyframe({
  0: { opacity: 1 },
  50: { opacity: 1 },
  100: { opacity: 0, easing: Easing.out(Easing.quad) },
})
  .duration(1200)
  .reduceMotion(ReduceMotion.Never);

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
  const background = kind === "likes" ? Gallery.groupedBackground : Gallery.paper;
  return (
    <BottomSheet
      isPresented
      onDismiss={onDismiss}
      snapPoints={[{ fraction: 0.78 }, "full"]}
      containerColor={background}
      contentPadding={{ top: 16, left: 0, right: 0, bottom: 0 }}
    >
      <RNHostView onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}>
        <View style={{ backgroundColor: background }}>
          <View style={styles.heading} onLayout={(event) => setHeadingHeight(event.nativeEvent.layout.height)}>
            <View style={{ width: 44 }} />
            <Text accessibilityRole="header" style={styles.title}>
              {title}{" "}
              <Text style={styles.total}>
                {summary ? (kind === "comments" ? summary.commentCount : summary.likeCount) : ""}
              </Text>
            </Text>
            <CloseButton label={`Close ${kind}`} onPress={onDismiss} />
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
  const likes = useCursorPages(api.visitReactions.listLikes, { postId }, session.key, likesPage, profileId);
  return (
    <SheetList
      items={likes.items}
      itemKey={profileId}
      height={height}
      onEndReached={likes.loadMore}
      renderItem={(item, index) => (
        <View style={styles.person}>
          <ProfileRow profile={item} first={index === 0} last={index === likes.items.length - 1} onOpen={onDismiss} />
        </View>
      )}
      empty={likes.done && !likes.loading && !likes.error ? <Empty title="No likes yet." /> : null}
      footer={
        !likes.done || likes.loading || likes.error ? (
          <PageFooter {...likes} count={likes.items.length} noun="likes" skeleton="card" />
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
  const safety = useSafetyChecks(session);
  const canWrite = session.status === "ready" && safety.enabled;
  const blocking = useBlock(session);
  const list = useRef<ScrollViewInstance>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const tagging = useRichTextInput({
    text: draft,
    onChangeText: setDraft,
    maxLength: MAX_COMMENT_LENGTH,
    editable: !busy,
    place: { kind: "comment", postId: visit.postId },
  });
  const input = useRef<TextInputInstance>(null);
  // Replying fills in the person's handle; the "Replying to" bar lasts while the draft still starts with it.
  const [replyTo, setReplyTo] = useState<PublicProfile>();
  const handle = replyTo ? `@${replyTo.username}` : "";
  const replying = !!replyTo && (draft === handle || draft.startsWith(`${handle} `));
  const afterHandle = () => (replying ? draft.slice(handle.length).trimStart() : draft);
  const reply = (item: Comment) => {
    if (busy) return;
    if (!tagging.replace(`@${item.author.username} ${afterHandle()}`)) {
      setError("Shorten your comment to add a reply.");
      return;
    }
    setError(undefined);
    setReplyTo(item.author);
    input.current?.focus();
  };
  const cancelReply = () => {
    if (tagging.replace(afterHandle())) setReplyTo(undefined);
  };
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
  const likeRequests = useRef(new Map<string, boolean>());
  const [likeTargets, setLikeTargets] = useState<ReadonlyMap<string, boolean>>(new Map());
  const { canLoadMore, loadMore } = comments;
  const postedVisible = !!posted && comments.items.some((item) => item.commentId === posted);
  useEffect(() => {
    if (posted && !postedVisible && canLoadMore) loadMore();
  }, [posted, postedVisible, canLoadMore, loadMore]);
  // The live list usually delivers a new comment before its mutation returns, so the reveal waits for both.
  const [reveals, setReveals] = useState(0);
  const [revealed, setRevealed] = useState<string>();
  if (postedVisible) {
    setPosted(undefined);
    setRevealed(posted);
    setReveals((count) => count + 1);
  }
  useEffect(() => {
    if (reveals === 0) return;
    list.current?.scrollToEnd({ animated: true });
    playSuccessHaptic();
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
      setReplyTo(undefined);
      request.current = null;
      setPosted(id);
    } catch (cause) {
      playErrorHaptic();
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
    playToggleHaptic(!item.liked);
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
  const canReply = (item: Comment) => canWrite && session.profileId !== item.author.profileId;
  const actionsFor = (item: Comment): CommentAction[] => [
    ...(canReply(item) ? [{ name: "reply", label: "Reply", run: () => reply(item) }] : []),
    { name: "copy", label: "Copy Comment", run: () => void copy(item) },
    ...(session.profileId === item.author.profileId
      ? [{ name: "delete", label: "Delete Comment", destructive: true, run: () => remove(item) }]
      : session.status === "loading"
        ? []
        : [
            {
              name: "report",
              label: "Report Comment",
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
    playMediumHaptic();
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
          const openAuthor = () => {
            onDismiss();
            router.push(profileHref(item.author.profileId));
          };
          // VoiceOver reads the comment as one element, so each link is also one of its actions.
          const spoken = [
            ...actions,
            { name: "profile", label: `View ${item.author.name}’s profile`, run: openAuthor },
            ...extractHashtags(item.body).map((tag) => ({
              name: `tag:${tag}`,
              label: `Open #${tag}`,
              run: () => {
                onDismiss();
                router.push(tagHref(tag));
              },
            })),
            ...item.mentions.map((mention) => ({
              name: `mention:${mention.username}`,
              label: `Open @${mention.username}`,
              run: () => {
                onDismiss();
                router.push(profileHref(mention.profileId));
              },
            })),
          ];
          const target = likeTargets.get(item.commentId);
          const { liked, likeCount } = withPendingLike(item, target);
          return (
            <View
              style={[
                styles.comment,
                menuFor === item.commentId && { backgroundColor: Gallery.fill },
                deleting === item.commentId && { opacity: 0.5 },
              ]}
            >
              {revealed === item.commentId && (
                <Animated.View
                  key={reveals}
                  pointerEvents="none"
                  entering={REVEAL_HIGHLIGHT}
                  style={[StyleSheet.absoluteFill, styles.revealed]}
                />
              )}
              <MotionPressable
                accessibilityLabel={`${item.author.name}${item.isAuthor ? ", author" : ""}, ${time}: ${item.body}`}
                accessibilityState={{ busy: deleting === item.commentId }}
                accessibilityActions={spoken.map(({ name, label }) => ({ name, label }))}
                onAccessibilityAction={({ nativeEvent }) =>
                  spoken.find((action) => action.name === nativeEvent.actionName)?.run()
                }
                onLongPress={() => showActions(item)}
                style={styles.commentContent}
              >
                <MotionPressable accessible={false} onPress={openAuthor}>
                  <ProfileAvatar
                    name={item.author.name}
                    photoUrl={item.author.photoUrl}
                    avatar={item.author.avatar}
                    size={28}
                  />
                </MotionPressable>
                <View style={{ flex: 1 }}>
                  <View style={styles.byline}>
                    <TextLink href={profileHref(item.author.profileId)} onOpen={onDismiss} style={styles.name}>
                      {item.author.name}
                    </TextLink>
                    {item.isAuthor && <Text style={styles.author}>Author</Text>}
                    <Text style={styles.meta}>{time}</Text>
                  </View>
                  <TaggedText style={styles.body} mentions={item.mentions} onOpenLink={onDismiss}>
                    {item.body}
                  </TaggedText>
                  {canReply(item) && (
                    <Pressable
                      accessible={false}
                      hitSlop={{ top: 12, bottom: 12, left: 8, right: 16 }}
                      onPress={() => reply(item)}
                      style={styles.replyLink}
                    >
                      {({ pressed }) => <Text style={[styles.reply, pressed && { opacity: 0.5 }]}>Reply</Text>}
                    </Pressable>
                  )}
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
                <LikeHeart liked={liked} size={16} color={Gallery.muted} />
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
        {replyTo && replying && (
          <View style={styles.replyBar}>
            <Text style={styles.replyText} numberOfLines={1}>
              Replying to <Text style={styles.replyName}>{replyTo.name}</Text>
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel reply"
              hitSlop={4}
              onPress={cancelReply}
              style={styles.replyCancel}
            >
              <VisitSymbol name="xmark" size={12} color={Gallery.muted} />
            </Pressable>
          </View>
        )}
        {error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        {canWrite ? (
          <>
            {tagging.suggestions}
            <View style={styles.inputRow}>
              <ProfileAvatar
                name={viewer.data?.name ?? "You"}
                photoUrl={viewer.data?.photoUrl}
                avatar={viewer.data?.avatar}
                size={28}
              />
              <View style={[styles.inputWrap, focused && { borderColor: Gallery.accent }]}>
                <TextInput
                  ref={input}
                  accessibilityLabel="Add a comment"
                  placeholder="Add a comment…"
                  placeholderTextColor={Gallery.muted}
                  {...tagging.inputProps}
                  multiline
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
          </>
        ) : (
          <View style={styles.join}>
            <Text style={[styles.body, { flex: 1 }]}>
              {session.status === "ready"
                ? "Turn on safety checks to comment."
                : session.status === "profile-required"
                  ? "Create a profile to comment."
                  : "Sign in to comment."}
            </Text>
            {session.status === "ready" ? (
              <GalleryButton label="Turn on" disabled={safety.busy} onPress={() => void safety.turnOn()} />
            ) : (
              <GalleryButton
                label={session.status === "profile-required" ? "Create profile" : "Sign in"}
                onPress={onJoin}
              />
            )}
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
  renderItem: (item: T, index: number) => ReactNode;
  empty: ReactNode;
  footer: ReactNode;
  height?: number;
  onEndReached: () => void;
  ref?: Ref<ScrollViewInstance>;
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
      {items.length === 0
        ? empty
        : items.map((item, index) => <Fragment key={itemKey(item)}>{renderItem(item, index)}</Fragment>)}
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
  person: { marginHorizontal: 20 },
  comment: { flexDirection: "row", alignItems: "flex-start", paddingLeft: 20, paddingRight: 8 },
  revealed: { backgroundColor: Gallery.highlight },
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
  replyLink: { alignSelf: "flex-start", marginTop: 4 },
  reply: { fontSize: 12, lineHeight: 16, fontWeight: "600", color: Gallery.muted },
  // Spans the composer's insets so the bar reads as a band on top of the field.
  replyBar: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: -20,
    marginTop: -12,
    paddingLeft: 20,
    backgroundColor: Gallery.fill,
  },
  replyText: { flex: 1, fontSize: 13, lineHeight: 18, color: Gallery.muted },
  replyName: { fontWeight: "600", color: Gallery.ink },
  replyCancel: { width: 44, height: 36, alignItems: "center", justifyContent: "center" },
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
    ...PinnedFooterBorder,
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
  join: { flexDirection: "row", alignItems: "center", gap: 12 },
  error: { fontSize: 13, lineHeight: 19, color: Gallery.destructive },
});
