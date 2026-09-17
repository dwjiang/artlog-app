import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { SocialText as Text } from './social-text';
import { GalleryButton } from '@/components/collection/gallery-button';
import { signInRoute, type SignInContext } from '@/lib/account/sign-in-context';
import { Gallery } from '@/constants/theme';
import type { SocialSession } from '@/lib/social/use-social-session';
import { socialErrorMessage } from '@/shared/social/errors';
import { socialStyles } from './social-styles';

export function SocialState({ title, detail, icon = 'rectangle.3.group', loading, action, onAction }: {
  title: string; detail?: string; icon?: string; loading?: boolean; action?: string; onAction?: () => void;
}) {
  return <View style={socialStyles.state}>
    {loading ? <ActivityIndicator color={Gallery.accent} accessibilityLabel={title} />
      : <Image source={`sf:${icon}`} tintColor={Gallery.accent} style={{ width: 40, height: 40 }} />}
    <Text accessibilityRole="header" style={socialStyles.title}>{title}</Text>
    {detail && <Text selectable style={socialStyles.body}>{detail}</Text>}
    {action && onAction && <GalleryButton label={action} onPress={onAction} variant="filled" capsule />}
  </View>;
}

export function SocialGate({ session, browsePublic = false, context = 'friends' }: { session: SocialSession; browsePublic?: boolean; context?: SignInContext }) {
  const router = useRouter();
  if (session.status === 'ready') return null;
  if (session.status === 'signed-out') return <View style={socialStyles.gate}>
    <SocialState title="Art is better together." detail="See the museum visits and artworks your friends share." icon="person.2"
      action="Sign in" onAction={() => router.push(signInRoute(context))} />
    {browsePublic && <GalleryButton label="Browse public walls" variant="outlined" onPress={() => router.push('/people')} />}
  </View>;
  if (session.status === 'profile-required') return <View style={socialStyles.section}><SocialState title="Make yourself at home."
    detail="Create your public profile to find friends and follow their museum visits." icon="person.crop.circle.badge.plus"
    action="Create your profile" onAction={() => router.push('/create-profile')} />
    {browsePublic && <GalleryButton label="Browse public walls" variant="outlined" onPress={() => router.push('/people')} />}</View>;
  if (session.status === 'offline') return <SocialState title="You’re offline."
    detail="Connect to see the latest shared visits. Your saved collection is still here." icon="wifi.slash" />;
  if (session.status === 'error') return <SocialState title="Couldn’t load your account."
    detail={socialErrorMessage(session.error) ?? 'Check your connection and try again.'}
    action="Try again" onAction={session.refresh} />;
  return <SocialState title="Getting things ready…" loading />;
}

export function PageFooter({ loading, error, done, count, loadMore, refresh, noun = 'visits', canLoadMore }: {
  loading: boolean; error?: Error; done: boolean; count: number; loadMore: () => void; refresh: () => void;
  canLoadMore: boolean; noun?: string;
}) {
  if (loading) return <SocialState title={`Loading ${noun}…`} loading />;
  if (error) return <SocialState title={`Couldn’t load ${noun}.`} detail={socialErrorMessage(error) ?? 'Please try again.'}
    action="Try again" onAction={refresh} />;
  if (!done) return <View style={socialStyles.footer}>
    <GalleryButton label={canLoadMore ? `More ${noun}` : 'Try again'} onPress={canLoadMore ? loadMore : refresh} />
  </View>;
  if (count > 0 && noun === 'visits') return <View style={{ alignItems: 'center', paddingHorizontal: 20, paddingTop: 26, paddingBottom: 8, gap: 2 }}>
    <Text style={{ fontSize: 12, lineHeight: 20, color: Gallery.muted }}>You’re all caught up.</Text>
    <Text style={{ fontSize: 10, lineHeight: 18, color: Gallery.muted }}>Tap a name to explore their public wall.</Text>
  </View>;
  return count > 0 ? <View style={socialStyles.footer}>
    <Image source="sf:checkmark.circle" tintColor={Gallery.muted} style={{ width: 22, height: 22 }} />
    <Text style={socialStyles.caption}>{`All ${noun} shown.`}</Text>
  </View> : null;
}
