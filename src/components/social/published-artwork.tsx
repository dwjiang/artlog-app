import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SocialText as Text } from './social-text';
import { socialStyles } from './social-styles';
import { Gallery } from '@/constants/theme';
import type { SharedArtwork } from '@/lib/social/types';
import { isLightWall, type WallFrame as Frame } from '@/lib/wall/wall-layout';
import { WallFrame, wallFrameInset } from '../collection/wall-frame';
import { DisplayMedia } from '../artwork/display-media';
import { DocentSection, type DocentSectionProps } from '../scan/result/docent-section';

export function PublishedArtwork({ artwork, photos, shared = false, color, frame = 'gilt', token, note, enrichment }: {
  artwork: SharedArtwork['artwork']; photos: SharedArtwork['artwork']['media'][]; shared?: boolean;
  color: string; frame?: Frame; token?: string | null; note?: string; enrichment?: DocentSectionProps;
}) {
  const { width } = useWindowDimensions();
  return <>
    <PublishedArtworkGallery key={`${width}:${JSON.stringify(photos)}`} title={artwork.title} photos={photos}
      label={shared ? 'Shared for this visit' : 'Selected wall photo'} color={color} frame={frame} width={width} token={token} />
    <View style={styles.details}>
      <View style={styles.museumLabel}>
        <Text selectable accessibilityRole="header" style={styles.artist}>{artwork.artist || 'Artist unknown'}</Text>
        <Text selectable style={styles.title}>{artwork.title}{artwork.date ? `, ${artwork.date}` : ''}</Text>
        {!!artwork.medium && <Text selectable style={styles.caption}>{artwork.medium}</Text>}
      </View>
      <Text style={styles.caption}>{shared ? 'Shared from this visit. Other visits and private notes are not included.'
        : 'Selected for this public wall. Only the displayed wall photo is included.'}</Text>
      {artwork.media.kind !== 'placeholder' && artwork.media.credit && <Text selectable style={styles.caption}>{artwork.media.credit}</Text>}
      {enrichment && <DocentSection docent={enrichment.docent} factSheet={enrichment.factSheet} title="About this work" />}
      {!!note && <View style={{ gap: 8 }}>
        <Text accessibilityRole="header" style={socialStyles.body}>Shared note</Text>
        <Text selectable style={{ ...socialStyles.body, fontFamily: 'Georgia' }}>{note}</Text>
      </View>}
    </View>
  </>;
}

function PublishedArtworkGallery({ title, photos, label, color, frame, width, token }: {
  title: string; photos: SharedArtwork['artwork']['media'][]; label: string; color: string; frame: Frame; width: number; token?: string | null;
}) {
  const gallery = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const ink = isLightWall(color) ? Gallery.ink : Gallery.paper;
  const goTo = (index: number) => {
    const next = Math.max(0, Math.min(photos.length - 1, index));
    setPage(next); gallery.current?.scrollTo({ x: next * width, animated: true });
  };
  if (!photos.length) return <View style={styles.emptyGallery}><Text style={styles.caption}>No photos shared for this artwork.</Text></View>;
  return <View style={{ backgroundColor: color, experimental_backgroundImage: 'linear-gradient(180deg, #ffffff1a 0%, transparent 24%, #00000017 100%)' }}>
    <ScrollView ref={gallery} horizontal pagingEnabled showsHorizontalScrollIndicator={false} accessibilityLabel="Artwork photos"
      onMomentumScrollEnd={({ nativeEvent }) => setPage(Math.max(0, Math.min(photos.length - 1, Math.round(nativeEvent.contentOffset.x / width))))}>
      {photos.map((media, index) => {
        const ratio = media.width > 0 && media.height > 0 ? media.width / media.height : 1;
        const outerWidth = Math.max(1, Math.min(width - 80, 265 * ratio));
        return <View key={index} style={[styles.slide, { width }]}>
          <WallFrame frame={frame} width={outerWidth}>
            <DisplayMedia media={media} label={`${title}, photo ${index + 1}`} width={Math.max(1, outerWidth - wallFrameInset(frame, outerWidth) * 2)} token={token} />
          </WallFrame>
        </View>;
      })}
    </ScrollView>
    <View style={styles.galleryFooter}>
      <Text style={[styles.caption, { color: ink, flexShrink: 1 }]}>{label}</Text>
      <View style={styles.navigation}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous photo" disabled={page === 0} onPress={() => goTo(page - 1)}
          style={[styles.arrow, page === 0 && { opacity: 0.4 }]}><Text style={[styles.arrowText, { color: ink }]}>‹</Text></Pressable>
        <Text accessibilityLiveRegion="polite" style={[styles.caption, { color: ink, fontVariant: ['tabular-nums'] }]}>{page + 1} / {photos.length}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Next photo" disabled={page >= photos.length - 1} onPress={() => goTo(page + 1)}
          style={[styles.arrow, page >= photos.length - 1 && { opacity: 0.4 }]}><Text style={[styles.arrowText, { color: ink }]}>›</Text></Pressable>
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  slide: { height: 305, paddingTop: 23, paddingBottom: 16, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  galleryFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 20, paddingBottom: 8 },
  navigation: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  arrow: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  arrowText: { fontSize: 24 },
  details: { padding: 20, gap: 18 },
  museumLabel: { gap: 5 },
  artist: { color: Gallery.ink, fontSize: 19, lineHeight: 25, fontWeight: '600' },
  title: { color: Gallery.ink, fontSize: 15, lineHeight: 22, fontStyle: 'italic' },
  caption: { color: Gallery.muted, fontSize: 11, lineHeight: 17 },
  emptyGallery: { minHeight: 160, padding: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: Gallery.fill },
});
