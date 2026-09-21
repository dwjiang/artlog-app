import { ScrollView, View } from 'react-native';
import { ThemedText } from '../themed-text';
import { MuseumSearchSection } from './museum-search-section';
import { Gallery } from '@/constants/theme';

export function PrivacySection({ onRequestConsent }: { onRequestConsent: () => void }) {
  return <ScrollView style={{ flex: 1, backgroundColor: Gallery.paper }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, gap: 24 }}>
    <View style={{ gap: 12 }}><ThemedText variant="pageTitle">{'Your art.\nYour choice.'}</ThemedText><ThemedText themeColor="textSecondary">Here’s how Artlog uses your photos and information.</ThemedText></View>
    <MuseumSearchSection onRequestConsent={onRequestConsent} />
    <ThemedText variant="section">How your data is used</ThemedText>
    {[
      ['Identifying art', 'Identification sends a numeric fingerprint of your photo. Reading a label sends the label photo. Museum-site search only sends a painting crop with your consent. Those features do not store the images.'],
      ['Your photos', 'Saving an artwork uploads a private, resized copy for backup and sync. Camera and location metadata are removed from that copy. The original stays on your iPhone.'],
      ['Helping other visitors', 'Saving a confirmed work contributes its label details, numeric fingerprint and a small artwork crop to the shared index. You can withdraw these in Contributions.'],
      ['Your location', 'Your location is used on this iPhone to find the museum. Coordinates never leave your phone.'],
    ].map(([title, copy]) => <View key={title} style={{ gap: 8, paddingBottom: 18, borderBottomWidth: 0.5, borderBottomColor: Gallery.separator }}><ThemedText style={{ fontSize: 16, fontWeight: '600' }}>{title}</ThemedText><ThemedText style={{ fontSize: 15, lineHeight: 23, color: Gallery.muted }}>{copy}</ThemedText></View>)}
  </ScrollView>;
}
