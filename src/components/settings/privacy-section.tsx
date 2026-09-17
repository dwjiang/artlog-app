import { router } from 'expo-router';
import { View } from 'react-native';

import { LeaderboardPreference } from './leaderboard-preference';
import { MuseumSearchSection } from './museum-search-section';
import { SettingsRow } from './settings-row';
import { ThemedText } from '@/components/themed-text';

export const PRIVACY_COPY = "Identification sends a numeric fingerprint of your photo. Label reading sends the label photo; museum-site search sends a crop of the painting only with your consent. These images aren't stored by those features. Saving a work uploads a private copy of your photo and crop for backup and sync. The cloud copy is resized and excludes camera and location metadata; the original stays on your phone. Contributions share a small crop with the index only when you choose. Your location is used on the phone to find the museum; coordinates never leave your phone.";

export function PrivacySection() {
  return <View style={{ gap: 2 }}>
    <LeaderboardPreference />
    <SettingsRow title="Public notes" detail="Choose which notes appear on your wall." onPress={() => router.push('/public-notes')} />
    <SettingsRow title="Visit sharing" detail="Chosen for each visit. Your complete history and globe are never public." trailing="lock" />
    <View style={{ paddingTop: 16, gap: 16 }}>
      <MuseumSearchSection />
      <ThemedText type="small" themeColor="textSecondary">{PRIVACY_COPY}</ThemedText>
    </View>
  </View>;
}
