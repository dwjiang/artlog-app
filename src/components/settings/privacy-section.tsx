import { ScrollView, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";

import { MuseumSearchSection } from "./museum-search-section";

export function PrivacySection({ onRequestConsent }: { onRequestConsent: () => void }) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: Gallery.paper }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 20, gap: 24 }}
    >
      <ThemedText themeColor="textSecondary">Here’s how Artlog uses your photos and information.</ThemedText>
      <MuseumSearchSection onRequestConsent={onRequestConsent} />
      <ThemedText variant="section">How your data is used</ThemedText>
      {[
        [
          "Identifying art",
          "Identification sends a numeric fingerprint of your photo. Label reading happens on your phone and sends only the label’s text. Museum-site search compares the museum’s images on your phone and sends no photo.",
        ],
        [
          "Your photos",
          "Saving an artwork uploads a private, resized copy for backup and sync. Camera and location metadata are removed from that copy. The original stays on your iPhone.",
        ],
        [
          "Helping other visitors",
          "Saving a confirmed work contributes its label details, numeric fingerprint and a small artwork crop to the shared index. You can withdraw these in Contributions.",
        ],
        [
          "Your location",
          "Your location helps this iPhone find nearby museums. Apple Maps searches may send a search area centered on your location to Apple. Artlog’s servers receive the selected museum, but not your GPS coordinates. Confirming a new place also sends that place’s name, coordinates and website to Artlog.",
        ],
      ].map(([title, copy]) => (
        <View
          key={title}
          style={{
            gap: 8,
            paddingBottom: 18,
            borderBottomWidth: 0.5,
            borderBottomColor: Gallery.separator,
          }}
        >
          <ThemedText style={{ fontSize: 16, fontWeight: "600" }}>{title}</ThemedText>
          <ThemedText style={{ fontSize: 15, lineHeight: 23, color: Gallery.muted }}>{copy}</ThemedText>
        </View>
      ))}
    </ScrollView>
  );
}
