import type { ReactNode } from 'react';
import { useState } from 'react';
import { View } from 'react-native';
import { WallGallery } from '../collection/wall-gallery';
import { Gallery } from '@/constants/theme';
import type { PublicProfile, PublicWall } from '@/lib/social/types';
import { isLightWall } from '@/lib/wall/wall-layout';
import { ProfileAvatar } from './profile-avatar';
import { ProfileBio } from './profile-bio';
import { ThemedText as Text } from '@/components/themed-text';
import { socialStyles } from './social-styles';

export function PublicProfileHeader({ person, actions, children, visitCount }: { person: PublicProfile; visitCount?: number; actions?: ReactNode; children?: ReactNode }) {
  return <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12, gap: 12 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
      <ProfileAvatar name={person.name} photoUrl={person.photoUrl} size={96} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text variant="display" style={{ color: Gallery.ink, fontSize: 44, lineHeight: 52 }}>{person.name}</Text>
        <Text style={socialStyles.caption}>@{person.username}</Text>
        <Text style={socialStyles.caption}>{person.publishedWallCount} {person.publishedWallCount === 1 ? 'artwork' : 'artworks'}{visitCount !== undefined ? ` · ${visitCount} ${visitCount === 1 ? 'visit' : 'visits'}` : ''}</Text>
      </View>
    </View>
    <ProfileBio text={person.bio} />
    {actions && <View>{actions}</View>}
    {children}
  </View>;
}

export function PublicWallView({ wall, arrangedBy, onSelect }: { wall: PublicWall; arrangedBy?: string; onSelect: (item: PublicWall['items'][number]) => void }) {
  const [width, setWidth] = useState(0);
  const wallInk = isLightWall(wall.color) ? Gallery.ink : Gallery.paper;
  return <View accessibilityLabel="Public collection wall" onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
    {width > 0 && <WallGallery width={width} color={wall.color}
      pieces={wall.items.map((item) => ({ localId: item.itemId, layout: item.layout, artwork: item.artwork }))}
      onSelect={(piece) => { const item = wall.items.find((row) => row.itemId === piece.localId); if (item) onSelect(item); }}>
      {!wall.items.length && <View style={{ minHeight: 440, padding: 32, gap: 16, alignItems: 'center', justifyContent: 'center' }}>
        <Text accessibilityRole="header" style={{ fontSize: 24, color: wallInk, textAlign: 'center' }}>A wall waiting for art.</Text>
        <Text style={{ fontSize: 14, lineHeight: 21, color: wallInk, textAlign: 'center', opacity: 0.85 }}>No artworks have been hung here yet.</Text>
      </View>}
    </WallGallery>}
    <Text style={{ ...socialStyles.caption, padding: 20, lineHeight: 18 }}>{wall.artworkCount} {wall.artworkCount === 1 ? 'artwork' : 'artworks'}{arrangedBy ? ` · arranged by ${arrangedBy}` : ''}. Only notes selected for public display appear here.</Text>
  </View>;
}
