import { socialStyles } from './social-styles';
import { ScrollView } from 'react-native';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { useSocialQuery } from '@/lib/social/use-social-query';
import { useSocialSession } from '@/lib/social/use-social-session';
import { convexErrorCode } from '@/lib/network-error';
import { socialErrorMessage } from '@/shared/social/errors';
import { SocialGate, SocialState } from './social-state';
import { PublishedArtwork } from './published-artwork';

export function ArtworkScreen({ kind, itemId, postId }: { kind: string; itemId: string; postId?: string }) {
  const session = useSocialSession();
  const shared = kind === 'visit';
  const invalid = !itemId || (kind !== 'wall' && !shared) || (shared && !postId);
  const sessionReady = ['ready', 'signed-out', 'profile-required'].includes(session.status);
  const canRead = !invalid && !session.offline && (!shared || sessionReady);
  const wall = useSocialQuery(api.walls.getArtwork, canRead && !shared ? { itemId: itemId as Id<'wallItems'> } : 'skip', session.key);
  const visit = useSocialQuery(api.sharedVisits.getArtwork,
    canRead && shared ? { itemId: itemId as Id<'sharedVisitItems'>, postId: postId! } : 'skip', session.key);
  const result = shared ? visit : wall;
  const data = result.data;
  const unavailable = invalid || data === null || convexErrorCode(result.error) === 'not_found';
  return <ScrollView style={socialStyles.root} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={socialStyles.content}>
    {session.offline || (shared && !sessionReady) ? <SocialGate session={session} />
      : unavailable ? <SocialState title="Artwork unavailable." detail="This artwork is no longer shared." />
        : result.error ? <SocialState title="Couldn’t load this artwork." detail={socialErrorMessage(result.error) ?? 'Please try again.'}
          action="Try again" onAction={result.refresh} /> : !data ? <SocialState title="Opening artwork…" loading /> : <PublishedArtwork key={`${session.key}:${itemId}`}
          artwork={data.artwork} photos={shared ? visit.data?.photos ?? [] : [data.artwork.media]} shared={shared}
          frame={shared ? 'none' : wall.data?.layout.frame ?? 'none'} token={session.token}
          enrichment={data.enrichment} note={shared ? undefined : wall.data?.note} />}
  </ScrollView>;
}
