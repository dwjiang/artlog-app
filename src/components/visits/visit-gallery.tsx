import { Image } from 'expo-image';
import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { Gallery } from '@/constants/theme';
import { normalizeSearch } from '@/shared/journal/limits';
import { WallFrame, wallFrameInset } from '../collection/wall-frame';
import { SavedWorkImage } from '../collection/saved-work-image';

export function matchesVisitSearch(work: { title: string; artist: string | null }, query: string) {
  return normalizeSearch(`${work.title} ${work.artist ?? ''}`).includes(normalizeSearch(query));
}

export function VisitGallerySearch({ value, onChangeText }: { value: string; onChangeText: (value: string) => void }) {
  return <View style={styles.search}>
    <Image source="sf:magnifyingglass" tintColor={Gallery.muted} style={{ width: 15, height: 15 }} />
    <TextInput accessibilityLabel="Search visit artworks" placeholder="Search this visit" placeholderTextColor={Gallery.muted}
      value={value} onChangeText={onChangeText} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing"
      returnKeyType="search" style={styles.input} />
  </View>;
}

export function VisitGalleryArtwork({ title, artist, photoCount, aspectRatio = 1, children }: {
  title: string; artist: string | null; photoCount: number; aspectRatio?: number;
  children: (imageWidth: number) => ReactNode;
}) {
  const { width } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const stageWidth = measuredWidth || Math.max(1, (width - 53) / 2);
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const frameWidth = Math.min(stageWidth * 0.83, stageWidth / 1.04 * 0.81 * ratio);
  return <>
    <View style={styles.stage} onLayout={(event) => setMeasuredWidth(event.nativeEvent.layout.width)}>
      <WallFrame frame="gilt" width={frameWidth}>{children(Math.max(1, frameWidth - wallFrameInset('gilt', frameWidth) * 2))}</WallFrame>
      {photoCount !== 1 && <View style={styles.badge}>
        {photoCount > 1 && <Image source="sf:photo.on.rectangle" tintColor="#555D4C" style={{ width: 11, height: 11 }} />}
        <Text style={styles.badgeText}>{photoCount ? `${photoCount} photos` : 'No photos'}</Text>
      </View>}
    </View>
    <Text numberOfLines={2} style={styles.title}>{title}</Text>
    <Text numberOfLines={2} style={styles.artist}>{artist || 'Artist unknown'}</Text>
  </>;
}

export function LocalVisitGalleryArtwork({ title, artist, photoCount, path }: {
  title: string; artist: string | null; photoCount: number; path: string | null;
}) {
  const [image, setImage] = useState<{ path: string | null; ratio: number }>();
  const ratio = image?.path === path ? image.ratio : 1;
  return <VisitGalleryArtwork title={title} artist={artist} photoCount={photoCount} aspectRatio={ratio}>
    {(width) => <SavedWorkImage contain path={path} title={title} style={{ width, aspectRatio: ratio }}
      onLoad={({ width: imageWidth, height }) => setImage({ path, ratio: imageWidth / height })} />}
  </VisitGalleryArtwork>;
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5, marginBottom: 13, paddingHorizontal: 12,
    backgroundColor: Gallery.fill, borderWidth: StyleSheet.hairlineWidth, borderColor: Gallery.separator, borderRadius: 9 },
  input: { flex: 1, minHeight: 44, color: Gallery.ink, fontSize: 13, paddingVertical: 10 },
  stage: { aspectRatio: 1.04, width: '100%', borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#E0E3D9', experimental_backgroundImage: 'linear-gradient(140deg, #E1E2DB 0%, #D4D7CE 100%)' },
  badge: { position: 'absolute', bottom: 6, right: 6, flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#F4F4EFEF', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3 },
  badgeText: { fontSize: 9, lineHeight: 15, color: '#555D4C' },
  title: { fontFamily: 'Georgia', fontStyle: 'italic', fontSize: 14, lineHeight: 19, color: Gallery.ink, marginTop: 9, marginHorizontal: 1 },
  artist: { fontSize: 10, lineHeight: 15, color: '#797C6F', marginTop: 2, marginHorizontal: 1 },
});
