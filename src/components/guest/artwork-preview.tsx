import { Image } from 'expo-image';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gallery, Spacing } from '@/constants/theme';

export const introArtworks = {
  pearl: { source: require('../../../assets/images/onboarding/girl-with-a-pearl-earring.jpg'), title: 'Girl with a Pearl Earring, Johannes Vermeer' },
  lilies: { source: require('../../../assets/images/onboarding/water-lilies.jpg'), title: 'Water Lilies, Claude Monet' },
  stars: { source: require('../../../assets/images/onboarding/starry-night.jpg'), title: 'The Starry Night, Vincent van Gogh' },
} as const;

export function ArtworkCollage({ welcome = false }: { welcome?: boolean }) {
  const { width, height, fontScale } = useWindowDimensions();
  const size = Math.min(width - Spacing.content * 2, height < 760 || fontScale > 1.3 ? 280 : 360);
  const prints = welcome ? [
    { artwork: introArtworks.lilies, left: 0.02, top: 0.17, width: 0.43, height: 0.55, rotate: '-9deg' },
    { artwork: introArtworks.stars, left: 0.55, top: 0.21, width: 0.43, height: 0.55, rotate: '9deg' },
    { artwork: introArtworks.pearl, left: 0.29, top: 0.06, width: 0.43, height: 0.70, rotate: '5deg' },
  ] : [
    { artwork: introArtworks.pearl, left: 0.02, top: 0.08, width: 0.43, height: 0.51, rotate: '-9deg' },
    { artwork: introArtworks.stars, left: 0.55, top: 0.06, width: 0.43, height: 0.51, rotate: '9deg' },
    { artwork: introArtworks.lilies, left: 0.28, top: 0.19, width: 0.44, height: 0.44, rotate: '0deg' },
  ];
  return <View style={styles.center}>
    <View accessibilityElementsHidden style={{ width: size, height: size * (welcome ? 0.83 : 0.68) }}>
      {prints.map(({ artwork, left, top, width: printWidth, height: printHeight, rotate }) => <View key={artwork.title}
        style={[styles.print, { left: left * size, top: top * size, width: printWidth * size, height: printHeight * size, transform: [{ rotate }] }]}>
        <Image source={artwork.source} contentFit="cover" style={styles.image} accessible={false} />
      </View>)}
    </View>
  </View>;
}

export function ArtworkStrip() {
  return <View accessibilityElementsHidden style={styles.strip}>
    {Object.values(introArtworks).map((artwork) => <Image key={artwork.title} source={artwork.source} contentFit="cover"
      accessible={false} style={styles.thumbnail} />)}
  </View>;
}

export function ArtworkMedallions() {
  return <View accessibilityElementsHidden style={styles.medallions}>
    {[introArtworks.pearl, introArtworks.lilies].map((artwork, index) => <Image key={artwork.title} source={artwork.source}
      accessible={false} contentFit="cover" style={[styles.medallion, index > 0 && { marginLeft: -12 }]} />)}
  </View>;
}

const styles = StyleSheet.create({
  center: { alignItems: 'center' },
  print: { position: 'absolute', padding: 5, backgroundColor: Gallery.surface, boxShadow: '0 4px 10px rgba(17,17,17,0.16)' },
  image: { width: '100%', height: '100%' },
  strip: { flexDirection: 'row', gap: Spacing.two, maxWidth: 400, width: '100%' },
  thumbnail: { flex: 1, aspectRatio: 0.9, maxHeight: 136 },
  medallions: { flexDirection: 'row' },
  medallion: { width: 60, height: 60, borderRadius: 30, borderWidth: 2, borderColor: Gallery.paper },
});
