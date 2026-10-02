import { FlatList, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";

export type ThirdPartyNotices = {
  entries: { name: string; version?: string; license: string; holder?: string; text: number }[];
  texts: string[];
};

export function OpenSourceLicenses({ notices }: { notices: ThirdPartyNotices }) {
  return (
    <FlatList
      style={{ flex: 1, backgroundColor: Gallery.paper }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 8 }}
      data={notices.entries}
      keyExtractor={(entry) => `${entry.name}@${entry.version ?? ""}`}
      initialNumToRender={5}
      ItemSeparatorComponent={Separator}
      renderItem={({ item }) => (
        <View style={{ gap: 6, paddingVertical: 20 }}>
          <ThemedText variant="section" accessibilityRole="header">
            {item.name}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {[item.version, item.license, item.holder].filter(Boolean).join(" · ")}
          </ThemedText>
          <ThemedText type="small">{notices.texts[item.text]}</ThemedText>
        </View>
      )}
    />
  );
}

function Separator() {
  return <View style={{ height: 0.5, backgroundColor: Gallery.separator }} />;
}
