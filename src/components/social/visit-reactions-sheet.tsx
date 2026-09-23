import { BottomSheet, RNHostView } from '@expo/ui';
import { useMutation } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { randomUUID } from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { api } from '../../../convex/_generated/api';
import { Gallery } from '@/constants/theme';
import { visitDate } from '@/lib/social/presentation';
import { formatRelativeTime } from '@/lib/queue/relative-time';
import type { PublicProfile } from '@/lib/social/types';
import { useCursorPages, useSocialQuery } from '@/lib/social/use-social-query';
import type { SocialSession } from '@/lib/social/use-social-session';
import { socialErrorMessage } from '@/shared/social/errors';
import { MAX_COMMENT_LENGTH } from '@/shared/social/visit-reactions';
import { DisplayMedia } from '../artwork/display-media';
import { GalleryButton } from '../collection/gallery-button';
import { GalleryIconButton } from '../collection/gallery-icon-button';
import { LoadingRing } from '../loading-ring';
import { ThemedText as Text } from '../themed-text';
import { VisitSymbol } from '../visits/visit-ui';
import { ProfileAvatar } from './profile-avatar';
import { PageFooter } from './social-state';
import type { ReactionSummary, ReactionVisit } from './visit-reactions';

type CommentPage = FunctionReturnType<typeof api.visitReactions.listComments>;
type Comment = CommentPage['page'][number];
const commentsPage = (value: CommentPage) => value;
const commentId = (value: Comment) => value.commentId;
const likesPage = (value: FunctionReturnType<typeof api.visitReactions.listLikes>) => value;
const profileId = (value: PublicProfile) => value.profileId;

export function VisitReactionsSheet({ kind, visit, summary, session, onDismiss, onJoin }: {
  kind: 'comments' | 'likes'; visit: ReactionVisit; summary?: ReactionSummary; session: SocialSession; onDismiss: () => void; onJoin: () => void;
}) {
  const title = kind === 'comments' ? 'Comments' : 'Likes';
  return <BottomSheet isPresented onDismiss={onDismiss} snapPoints={[{ fraction: 0.78 }, 'full']} containerColor={Gallery.paper} contentPadding={{ top: 16, left: 0, right: 0, bottom: 0 }}>
    <RNHostView><View style={styles.sheet}>
      <View style={styles.heading}><View style={{ width: 44 }} /><Text accessibilityRole="header" style={styles.title}>{title} <Text style={styles.total}>{summary ? kind === 'comments' ? summary.commentCount : summary.likeCount : ''}</Text></Text>
        <GalleryIconButton label={`Close ${kind}`} icon="xmark" onPress={onDismiss} /></View>
      <View style={styles.context}>
        {kind === 'comments' && visit.media && <DisplayMedia media={visit.media} label="Visit artwork" token={session.token} width={40} height={40} />}
        <View style={{ flex: 1, gap: 2 }}><Text style={styles.contextName}>{visit.author.name}’s visit to {visit.venue.name}</Text>
          {kind === 'comments' && <Text style={styles.meta}>{visitDate(visit.visitedOn, undefined, 'short')}</Text>}</View>
      </View>
      {kind === 'comments' ? <Comments visit={visit} session={session} onJoin={onJoin} /> : <Likes postId={visit.postId} session={session} onDismiss={onDismiss} />}
    </View></RNHostView>
  </BottomSheet>;
}

function Likes({ postId, session, onDismiss }: { postId: string; session: SocialSession; onDismiss: () => void }) {
  const router = useRouter();
  const likes = useCursorPages(api.visitReactions.listLikes, { postId }, session.key, likesPage, profileId);
  return <FlatList data={likes.items} keyExtractor={profileId} style={styles.list} contentContainerStyle={styles.listContent}
    renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`View ${item.name}’s profile`} style={styles.person}
      onPress={() => { onDismiss(); router.push({ pathname: '/profile/[profileId]', params: { profileId: item.profileId } }); }}>
      <ProfileAvatar name={item.name} photoUrl={item.photoUrl} size={40} /><View style={{ flex: 1 }}><Text style={styles.name}>{item.name}</Text><Text style={styles.meta}>@{item.username}</Text></View>
    </Pressable>}
    ListEmptyComponent={likes.done && !likes.loading && !likes.error ? <Empty title="No likes yet." detail="Be the first to like this visit." /> : null}
    ListFooterComponent={!likes.done || likes.loading || likes.error ? <PageFooter {...likes} count={likes.items.length} noun="likes" /> : null} onEndReached={likes.loadMore} onEndReachedThreshold={0.4} />;
}

function Comments({ visit, session, onJoin }: { visit: ReactionVisit; session: SocialSession; onJoin: () => void }) {
  const comments = useCursorPages(api.visitReactions.listComments, { postId: visit.postId }, session.key, commentsPage, commentId);
  const viewer = useSocialQuery(api.profiles.mine, session.status === 'ready' ? {} : 'skip', session.key);
  const addComment = useMutation(api.visitReactions.addComment);
  const deleteComment = useMutation(api.visitReactions.deleteComment);
  const list = useRef<FlatList<Comment>>(null);
  const [draft, setDraft] = useState('');
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
  const { canLoadMore, loadMore } = comments;
  const postedVisible = !!posted && comments.items.some((item) => item.commentId === posted);
  useEffect(() => {
    if (posted && !postedVisible && canLoadMore) loadMore();
  }, [posted, postedVisible, canLoadMore, loadMore]);
  const send = async () => {
    const body = draft.trim();
    if (!body || pending.current || session.status !== 'ready') return;
    pending.current = true; setBusy(true); setError(undefined);
    if (request.current?.body !== body) request.current = { body, id: randomUUID() };
    try {
      const id = await addComment({ postId: visit.postId, body, requestId: request.current.id });
      setDraft(''); request.current = null; setPosted(id);
    } catch (cause) { setError(socialErrorMessage(cause) ?? 'Couldn’t post your comment. Your text is still here.'); }
    finally { pending.current = false; setBusy(false); }
  };
  const remove = (item: Comment) => Alert.alert('Delete comment?', 'This removes your comment from this visit.', [
    { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => {
      if (pending.current) return;
      pending.current = true; setDeleting(item.commentId); setError(undefined);
      try { await deleteComment({ postId: visit.postId, commentId: item.commentId }); }
      catch (cause) { setError(socialErrorMessage(cause) ?? 'Couldn’t delete your comment. Try again.'); }
      finally { pending.current = false; setDeleting(undefined); }
    } },
  ]);
  return <>
    <FlatList ref={list} data={comments.items} keyExtractor={commentId} style={styles.list} contentContainerStyle={styles.listContent}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive"
      onContentSizeChange={() => { if (postedVisible) { list.current?.scrollToEnd({ animated: true }); setPosted(undefined); } }}
      renderItem={({ item }) => <View style={styles.comment}>
        <ProfileAvatar name={item.author.name} photoUrl={item.author.photoUrl} size={32} />
        <View style={{ flex: 1, gap: 4 }}><View style={styles.byline}><Text style={styles.name}>{item.author.name}</Text>{item.isAuthor && <Text style={styles.author}>Author</Text>}
          <Text style={styles.meta}>{now - item.createdAt < 86_400_000 ? formatRelativeTime(item.createdAt, now) : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(item.createdAt)}</Text></View>
          <Text selectable style={styles.body}>{item.body}</Text>
          {session.profileId === item.author.profileId && <Pressable accessibilityRole="button" accessibilityLabel={`Delete comment: ${item.body}`}
            accessibilityState={{ disabled: !!deleting || busy, busy: deleting === item.commentId }} disabled={!!deleting || busy} onPress={() => remove(item)} style={styles.delete}>
            <Text style={styles.meta}>{deleting === item.commentId ? 'Deleting…' : 'Delete'}</Text></Pressable>}
        </View>
      </View>}
      ListEmptyComponent={comments.done && !comments.loading && !comments.error ? <Empty title="No comments yet." detail="Start the conversation about this visit." /> : null}
      ListFooterComponent={!comments.done || comments.loading || comments.error ? <PageFooter {...comments} count={comments.items.length} noun="comments" /> : null}
      onEndReached={comments.loadMore} onEndReachedThreshold={0.4} />
    <View style={styles.composer}>
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {session.status === 'ready' ? <>
        <View style={styles.inputRow}><ProfileAvatar name={viewer.data?.name ?? 'You'} photoUrl={viewer.data?.photoUrl} size={32} />
          <View style={[styles.inputWrap, focused && { borderColor: Gallery.accent }]}><TextInput accessibilityLabel="Add a comment" placeholder="Add a comment…" placeholderTextColor={Gallery.muted}
          value={draft} onChangeText={setDraft} editable={!busy} multiline maxLength={MAX_COMMENT_LENGTH} style={styles.input} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
          <Pressable accessibilityRole="button" accessibilityLabel={busy ? 'Posting comment' : 'Post comment'} accessibilityState={{ disabled: !draft.trim() || busy || !!deleting, busy }}
            disabled={!draft.trim() || busy || !!deleting} onPress={() => void send()} style={styles.sendTarget}>
            <View style={[styles.send, (!draft.trim() || busy) && { backgroundColor: Gallery.fill }]}>{busy ? <LoadingRing accessibilityLabel="Posting comment" size={18} />
              : <VisitSymbol name="arrow.up" size={18} color={draft.trim() ? Gallery.surface : Gallery.muted} />}</View>
          </Pressable></View>
        </View><Text style={styles.audience}>Comments are public, like this visit.</Text>
      </> : <View style={styles.join}><Text style={[styles.body, { flex: 1 }]}>{session.status === 'profile-required' ? 'Create a profile to join the conversation.' : 'Sign in to join the conversation.'}</Text>
        <GalleryButton label={session.status === 'profile-required' ? 'Create profile' : 'Sign in'} onPress={onJoin} /></View>}
    </View>
  </>;
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return <View style={styles.empty}><Text style={styles.name}>{title}</Text><Text style={styles.meta}>{detail}</Text></View>;
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: Gallery.paper },
  heading: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, minHeight: 48 },
  title: { flex: 1, textAlign: 'center', fontSize: 17, lineHeight: 24, fontWeight: '600' },
  total: { color: Gallery.muted, fontWeight: '400', fontSize: 13 },
  context: { marginHorizontal: 20, paddingBottom: 16, paddingTop: 4, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: Gallery.separator },
  contextName: { fontSize: 13, lineHeight: 19, fontWeight: '500', color: Gallery.ink },
  list: { flex: 1 }, listContent: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 8 },
  person: { minHeight: 69, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: Gallery.softBorder },
  comment: { flexDirection: 'row', gap: 10, paddingVertical: 12 },
  byline: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 7, rowGap: 2 },
  name: { fontSize: 13, lineHeight: 19, fontWeight: '600', color: Gallery.ink },
  author: { fontSize: 10, lineHeight: 16, color: Gallery.accent },
  meta: { fontSize: 12, lineHeight: 18, color: Gallery.muted },
  body: { fontSize: 14, lineHeight: 21, color: Gallery.ink },
  delete: { minHeight: 44, minWidth: 44, alignSelf: 'flex-start', justifyContent: 'center' },
  empty: { flex: 1, minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 8 },
  composer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: Gallery.separator },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', paddingLeft: 11, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: Gallery.controlBorder, backgroundColor: Gallery.surface },
  input: { flex: 1, minHeight: 44, maxHeight: 120, fontSize: 13, lineHeight: 18, paddingTop: 13, paddingBottom: 13, color: Gallery.ink },
  sendTarget: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  send: { width: 32, height: 32, borderRadius: 16, backgroundColor: Gallery.accent, alignItems: 'center', justifyContent: 'center' },
  audience: { fontSize: 10, lineHeight: 16, color: Gallery.muted, marginLeft: 41 },
  join: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  error: { fontSize: 13, lineHeight: 19, color: Gallery.destructive },
});
