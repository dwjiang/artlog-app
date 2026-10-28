import { Image } from "expo-image";
import { StyleSheet } from "react-native";

import { Radius } from "@/constants/theme";

const APP_ICON = require("../../assets/images/icon.png");

export function AppIcon({ size }: { size: number }) {
  return (
    <Image
      source={APP_ICON}
      contentFit="contain"
      accessible={false}
      style={[styles.icon, { width: size, height: size }]}
    />
  );
}

const styles = StyleSheet.create({
  icon: { borderRadius: Radius.card, borderCurve: "continuous" },
});
