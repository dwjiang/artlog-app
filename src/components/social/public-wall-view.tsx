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

export function PublicProfileHeader({ person, actions, children }: { person: PublicProfile; actions?: ReactNode; children?: ReactNode }) {
  return <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, gap: 12 }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
      <ProfileAvatar name={person.name} photoUrl={person.photoUrl} size={52} />
      {actions}
    </View>
    <View style={{ gap: 4 }}>
      <Text variant="display" style={{ color: Gallery.ink }}>{person.name}</Text>
      <Text style={socialStyles.caption}>@{person.username}</Text>
    </View>
    <ProfileBio text={person.bio} />
    {children}
  </View>;
}

export function PublicWallView({ wall, arrangedBy, onSelect }: { wall: PublicWall; arrangedBy?: string; onSelect: (item: PublicWall['items'][number]) => void }) {
  const [width, setWidth] = useState(0);
  const wallInk = isLightWall(wall.color) ? Gallery.ink : Gallery.paper;
  return <View accessibilityLabel="Public collection wall" onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
    <View style={{ paddingHorizontal: 20, paddingBottom: 14, flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
      <Text style={{ fontSize: 13, letterSpacing: 1.1, color: Gallery.muted }}>PUBLIC COLLECTION</Text>
      <Text style={{ fontSize: 13, color: Gallery.muted }}>{wall.artworkCount} {wall.artworkCount === 1 ? 'artwork' : 'artworks'}{arrangedBy ? ` · arranged by ${arrangedBy}` : ''}</Text>
    </View>
    {width > 0 && <WallGallery width={width} color={wall.color}
      pieces={wall.items.map((item) => ({ localId: item.itemId, layout: item.layout, artwork: item.artwork }))}
      onSelect={(piece) => { const item = wall.items.find((row) => row.itemId === piece.localId); if (item) onSelect(item); }}>
      {!wall.items.length && <View style={{ minHeight: 440, padding: 32, gap: 16, alignItems: 'center', justifyContent: 'center' }}>
        <Text accessibilityRole="header" style={{ fontSize: 24, color: wallInk, textAlign: 'center' }}>A wall waiting for art.</Text>
        <Text style={{ fontSize: 14, lineHeight: 21, color: wallInk, textAlign: 'center', opacity: 0.85 }}>No artworks have been hung here yet.</Text>
      </View>}
    </WallGallery>}
    <Text style={{ ...socialStyles.caption, padding: 20, lineHeight: 18 }}>A chosen wall, not a complete archive. Only notes selected for public display appear here.</Text>
  </View>;
}
