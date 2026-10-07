import { StyleSheet, View } from "react-native";

import { Gallery } from "@/constants/theme";

/** Goes between visits only. A hairline got lost against the art band's near-white wall, so this is a full-width band. */
export function VisitSeparator() {
  return <View style={styles.band} />;
}

const styles = StyleSheet.create({
  band: { height: 8, backgroundColor: Gallery.fill },
});
