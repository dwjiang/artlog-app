import { StyleSheet, View } from "react-native";

import { Gallery } from "@/constants/theme";

/** Goes between visits only. A full-width band stays visible against the art band's near-white wall. */
export function VisitSeparator() {
  return <View style={styles.band} />;
}

const styles = StyleSheet.create({
  band: { height: 8, backgroundColor: Gallery.fill },
});
