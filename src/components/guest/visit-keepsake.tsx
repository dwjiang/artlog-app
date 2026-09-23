import { Image } from "expo-image";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Spacing, Typography } from "@/constants/theme";

export function VisitKeepsake() {
  const { width, height, fontScale } = useWindowDimensions();
  const size = Math.min(width - Spacing.content * 2, height < 760 || fontScale > 1.3 ? 280 : 360);
  return (
    <View style={styles.root}>
      <View accessibilityElementsHidden style={{ width: size, height: size * 0.68 }}>
        <View
          style={[
            styles.postcard,
            { width: size * 0.6, height: size * 0.48, top: size * 0.06, right: size * 0.02 },
          ]}
        >
          <Image
            source={require("../../../assets/images/onboarding/museum-postcard.jpg")}
            contentFit="cover"
            style={styles.image}
            accessible={false}
          />
        </View>
        <View
          style={[styles.ticket, { width: size * 0.72, height: size * 0.39, top: size * 0.22 }]}
        >
          <View style={styles.ticketMain}>
            <Image
              source="sf:star"
              tintColor={Gallery.accent}
              style={styles.star}
              accessible={false}
            />
            <Text
              allowFontScaling={false}
              style={[
                Typography.section,
                { color: Gallery.accent, fontSize: size * 0.075, lineHeight: size * 0.085 },
              ]}
            >
              YOUR{"\n"}NEXT VISIT
            </Text>
            <View style={styles.rule} />
          </View>
          <View style={styles.stub}>
            <Text allowFontScaling={false} style={styles.admit}>
              ADMIT ONE
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center" },
  postcard: {
    position: "absolute",
    padding: 6,
    backgroundColor: Gallery.surface,
    transform: [{ rotate: "9deg" }],
    boxShadow: "0 4px 10px rgba(17,17,17,0.15)",
  },
  image: { width: "100%", height: "100%" },
  ticket: {
    position: "absolute",
    left: 3,
    flexDirection: "row",
    backgroundColor: "#F4EDDF",
    borderWidth: 1,
    borderColor: "#E2D8C5",
    transform: [{ rotate: "-8deg" }],
    boxShadow: "0 4px 9px rgba(17,17,17,0.14)",
  },
  ticketMain: { flex: 1, padding: 14, justifyContent: "center", gap: 8 },
  star: { position: "absolute", right: 12, top: 12, width: 15, height: 15 },
  rule: { height: 1, backgroundColor: Gallery.accent, width: "90%" },
  stub: {
    width: 35,
    alignItems: "center",
    justifyContent: "center",
    borderLeftWidth: 1,
    borderStyle: "dashed",
    borderColor: "#BCB5A9",
  },
  admit: {
    width: 80,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1.5,
    color: Gallery.muted,
    transform: [{ rotate: "-90deg" }],
  },
});
