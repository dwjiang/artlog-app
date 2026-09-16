import { socialStyles } from './social-styles';
import { ScrollView, View } from 'react-native';
import { SocialText as Text } from './social-text';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { useSocialQuery } from '@/lib/social/use-social-query';
import { useSocialSession } from '@/lib/social/use-social-session';
import { convexErrorCode } from '@/lib/network-error';
import { socialErrorMessage } from '@/shared/social/errors';
import { SocialGate, SocialState } from './social-state';
import { WallArtworkSummary } from '../collection/wall-sheets';
import { Gallery } from '@/constants/theme';
import { VisitArtworks } from './visit-card';

export function ArtworkScreen({ kind, itemId, postId, color }: { kind: string; itemId: string; postId?: string; color?: string }) {
  const session = useSocialSession();
  const shared = kind === 'visit';
  const invalid = !itemId || (kind !== 'wall' && !shared) || (shared && !postId);
  const canRead = !invalid && !session.offline && (!shared || session.status === 'ready');
  const wall = useSocialQuery(api.walls.getArtwork, canRead && !shared ? { itemId: itemId as Id<'wallItems'> } : 'skip', session.key);
  const visit = useSocialQuery(api.sharedVisits.getArtwork,
    canRead && shared ? { itemId: itemId as Id<'sharedVisitItems'>, postId: postId! } : 'skip', session.key);
  const result = shared ? visit : wall;
  const data = result.data;
  const unavailable = invalid || data === null || convexErrorCode(result.error) === 'not_found';
  return <ScrollView style={socialStyles.root} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={socialStyles.content}>
    {session.offline || (shared && session.status !== 'ready') ? <SocialGate session={session} />
      : unavailable ? <SocialState title="Artwork unavailable." detail="This artwork is no longer shared." />
        : result.error ? <SocialState title="Couldn’t load this artwork." detail={socialErrorMessage(result.error) ?? 'Please try again.'}
          action="Try again" onAction={result.refresh} /> : !data ? <SocialState title="Opening artwork…" loading /> : <>
          {!shared && wall.data ? <WallArtworkSummary color={color && /^#[0-9a-f]{6}$/i.test(color) ? color : Gallery.accent}
            piece={{ localId: wall.data.itemId, layout: wall.data.layout, artwork: wall.data.artwork }} />
            : <VisitArtworks artworks={[{ ...data, itemId: data.itemId as Id<'sharedVisitItems'> }]} token={session.token} />}
          <View style={socialStyles.section}>
            {shared && <><Text selectable accessibilityRole="header" style={socialStyles.title}>{data.artwork.title}</Text>
            <Text selectable style={socialStyles.body}>{data.artwork.artist}</Text>
            {data.artwork.date && <Text selectable style={socialStyles.caption}>{data.artwork.date}</Text>}
            {data.artwork.medium && <Text selectable style={socialStyles.caption}>{data.artwork.medium}</Text>}
            </>}{data.artwork.media.kind !== 'placeholder' && data.artwork.media.credit &&
              <Text selectable style={socialStyles.caption}>{data.artwork.media.credit}</Text>}
            {!shared && wall.data?.note && <>
              <Text accessibilityRole="header" style={socialStyles.body}>Shared note</Text>
              <Text selectable style={socialStyles.body}>{wall.data.note}</Text>
            </>}
          </View>
        </>}
  </ScrollView>;
}
