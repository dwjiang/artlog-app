import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";
import { Gallery } from "@/constants/theme";
import { ThemedText as Text } from "./themed-text";

export function EmptyPodium() {
  return (
    <View accessibilityElementsHidden style={styles.podium}>
      {[2, 1, 3].map((place) => (
        <View
          key={place}
          style={[
            styles.step,
            {
              height: place === 1 ? 110 : place === 2 ? 78 : 58,
              backgroundColor: place === 1 ? Gallery.highlight : Gallery.fill,
            },
          ]}
        >
          <Text allowFontScaling={false} variant="display" style={styles.place}>
            {place}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function EmptyPaper({ kind }: { kind: "label" | "note" }) {
  return (
    <View accessibilityElementsHidden style={styles.paperArea}>
      <View
        style={[styles.paper, { transform: [{ rotate: kind === "label" ? "-5deg" : "4deg" }] }]}
      >
        <Image
          source={kind === "label" ? "sf:building.columns" : "sf:quote.opening"}
          tintColor={Gallery.accent}
          accessible={false}
          style={{ width: 27, height: 27 }}
        />
        {[0, 1, 2].map((line) => (
          <View key={line} style={[styles.rule, { width: line === 2 ? "60%" : "100%" }]} />
        ))}
      </View>
    </View>
  );
}

export function EmptyMap() {
  return (
    <View accessibilityElementsHidden style={styles.map}>
      {[30, 95, 160].map((left) => (
        <View key={left} style={[styles.road, { left, transform: [{ rotate: "24deg" }] }]} />
      ))}
      <View style={[styles.road, { width: "100%", height: 14, top: 55 }]} />
      <View style={styles.park} />
      <View style={styles.location}>
        <View style={styles.dot} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  podium: {
    height: 136,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 8,
  },
  step: {
    width: 72,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  place: { fontSize: 34, lineHeight: 42 },
  paperArea: { height: 152, justifyContent: "center", alignItems: "center" },
  paper: {
    width: 208,
    gap: 12,
    padding: 20,
    backgroundColor: Gallery.surface,
    borderWidth: 0.5,
    borderColor: Gallery.separator,
    boxShadow: "0 4px 10px rgba(17,17,17,0.08)",
  },
  rule: { height: 2, backgroundColor: Gallery.separator },
  map: {
    width: 250,
    height: 140,
    borderRadius: 12,
    backgroundColor: "#EEEFE7",
    overflow: "hidden",
    alignSelf: "center",
  },
  road: { position: "absolute", width: 12, height: 170, top: -15, backgroundColor: Gallery.paper },
  park: {
    position: "absolute",
    width: 54,
    height: 40,
    backgroundColor: "#D9E4C8",
    borderRadius: 10,
    left: 155,
    top: 84,
    transform: [{ rotate: "24deg" }],
  },
  location: {
    position: "absolute",
    left: 102,
    top: 48,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#0A46F318",
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: 16,
    height: 16,
    backgroundColor: Gallery.accent,
    borderWidth: 3,
    borderColor: Gallery.surface,
    borderRadius: 8,
  },
});
