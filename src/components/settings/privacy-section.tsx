import { View } from 'react-native';

import { MuseumSearchSection } from './museum-search-section';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

export const PRIVACY_COPY = "Identification sends a numeric fingerprint of your photo. Label reading sends the label photo; museum-site search sends a crop of the painting only with your consent. These images aren't stored. Contributions keep a small crop only when you choose to share it. Your location is used on the phone to find the museum; coordinates never leave your phone.";

export function PrivacySection() {
  return <View style={{ gap: Spacing.three }}>
    <MuseumSearchSection />
    <ThemedText type="small" themeColor="textSecondary">{PRIVACY_COPY}</ThemedText>
  </View>;
}
