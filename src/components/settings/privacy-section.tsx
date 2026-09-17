import { Text } from '@expo/ui';
import { Section } from '@expo/ui/swift-ui';

import { MuseumSearchSection } from './museum-search-section';
import { Gallery } from '@/constants/theme';

export const PRIVACY_COPY = "Identification sends a numeric fingerprint of your photo. Label reading sends the label photo; museum-site search sends a crop of the painting only with your consent. These images aren't stored by those features. Saving a work uploads a private copy of your photo and crop for backup and sync. The cloud copy is resized and excludes camera and location metadata; the original stays on your phone. Contributions share a small crop with the index only when you choose. Your location is used on the phone to find the museum; coordinates never leave your phone.";

export function PrivacySection({ onRequestConsent }: { onRequestConsent: () => void }) {
  return <>
    <MuseumSearchSection onRequestConsent={onRequestConsent} />
    <Section title="How your data is used">
      <Text textStyle={{ fontSize: 13, color: Gallery.muted }}>{PRIVACY_COPY}</Text>
    </Section>
  </>;
}
