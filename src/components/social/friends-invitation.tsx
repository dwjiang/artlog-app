import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { AppleSignInAction } from '@/components/account/apple-sign-in-action';
import { GalleryButton } from '@/components/collection/gallery-button';
import { ArtworkStrip } from '@/components/guest/artwork-preview';
import { ThemedText as Text } from '@/components/themed-text';
import { Gallery, Spacing, Typography } from '@/constants/theme';
import { useAccount } from '@/lib/account/use-account';
import { ProfileAvatar } from './profile-avatar';

export function FriendsInvitation({ onExplore }: { onExplore: () => void }) {
  const account = useAccount();
  const { fontScale } = useWindowDimensions();
  return <View style={styles.root}>
    <View style={styles.example}>
      <Text style={styles.eyebrow}>EXAMPLE</Text>
      <View style={styles.card}>
        <ArtworkStrip />
        <View style={[styles.cardCaption, fontScale > 1.3 && { flexDirection: 'column', alignItems: 'flex-start' }]}>
          <View style={styles.visitCopy}>
            <Text variant="section">An afternoon of art</Text>
            <Text variant="metadata" themeColor="textSecondary">3 artworks · Shared visit</Text>
          </View>
          <View style={styles.avatars}>
            {['A', 'J', 'S'].map((initial, index) => <View key={initial} style={[styles.avatar, index > 0 && { marginLeft: -8 }]}>
              <ProfileAvatar name={initial} size={32} />
            </View>)}
          </View>
        </View>
      </View>
    </View>
    <View style={styles.copy}>
      <Text variant="display" accessibilityRole="header" style={[styles.title, fontScale > 1.3 && { ...Typography.display, maxWidth: '100%' }]}>See art through their eyes.</Text>
      <Text themeColor="textSecondary">Follow friends’ museum visits and the artworks they love.</Text>
    </View>
    <View style={styles.actions}>
      <AppleSignInAction state={account} />
      <GalleryButton label="Explore people" fullWidth onPress={onExplore} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { padding: Spacing.content, paddingTop: Spacing.three, gap: Spacing.four, maxWidth: 520, width: '100%', alignSelf: 'center' },
  example: { gap: Spacing.two },
  eyebrow: { fontSize: 11, lineHeight: 16, letterSpacing: 1.2, color: Gallery.muted },
  card: { padding: Spacing.compact, gap: Spacing.two, borderRadius: 8, borderWidth: 0.5, borderColor: Gallery.separator, backgroundColor: Gallery.surface, boxShadow: '0 2px 3px rgba(17,17,17,0.06)' },
  cardCaption: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  visitCopy: { flex: 1, gap: 2 },
  avatars: { flexDirection: 'row' },
  avatar: { borderRadius: 18, borderWidth: 2, borderColor: Gallery.surface },
  copy: { gap: Spacing.two },
  title: { fontSize: 36, lineHeight: 42, maxWidth: 300 },
  actions: { gap: Spacing.two },
});
