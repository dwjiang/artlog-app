import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Gallery, Radius, Spacing } from "@/constants/theme";
import { SAFETY_CHECKS_LIMIT, SAFETY_CHECKS_USE } from "@/lib/social/safety-checks";

const APP_ICON = require("../../../assets/images/icon.png");

export type PermissionKind = "camera" | "photos" | "location" | "notifications";
/** Safety checks ask for consent in-app; no iPhone prompt follows them. */
type AskKind = PermissionKind | "safetyChecks";

type PermissionCopy = {
  name: string;
  symbol: string;
  headline: string;
  use: { symbol: string; text: string };
  limit: string;
};

/** What each permission page says: the headline, what the access does, and where it stops. */
const PERMISSION_COPY: Record<AskKind, PermissionCopy> = {
  camera: {
    name: "Camera",
    symbol: "camera.fill",
    headline: "Scan artworks.",
    // No on-device promise: saved photos can reach the Wall, shared visits, and account backups.
    use: { symbol: "camera.viewfinder", text: "Identifies paintings and reads their wall labels." },
    limit: "Only used while Artlog is open.",
  },
  photos: {
    name: "Photos",
    symbol: "photo.badge.plus.fill",
    headline: "Keep the photo.",
    use: { symbol: "photo", text: "Adds the full-size original of each artwork you save." },
    limit: "Artlog can’t see your other photos.",
  },
  location: {
    name: "Location",
    symbol: "location.fill",
    headline: "Find the museum.",
    use: { symbol: "building.columns", text: "Names the museum you’re in and groups each visit." },
    limit: "Only used while Artlog is open.",
  },
  notifications: {
    name: "Notification",
    symbol: "bell.fill",
    headline: "Hear back from friends.",
    use: {
      symbol: "bell",
      text: "Tells you about friend requests, likes, comments, open visits, and shows you want to see.",
    },
    limit: "Choose which in Settings.",
  },
  safetyChecks: {
    name: "Safety checks",
    symbol: "checkmark.shield.fill",
    headline: "Keep posts safe.",
    use: { symbol: "text.bubble", text: SAFETY_CHECKS_USE },
    limit: SAFETY_CHECKS_LIMIT,
  },
};

/** A permission page's copy, laid out the same on the welcome pages and in the notifications sheet. */
export function PermissionAsk({ kind }: { kind: AskKind }) {
  return (
    <View style={styles.ask}>
      <PermissionMark kind={kind} />
      <ThemedText variant="display" accessibilityRole="header" style={styles.headline}>
        {PERMISSION_COPY[kind].headline}
      </ThemedText>
      <PermissionReasons kind={kind} />
    </View>
  );
}

/** Artlog's icon linked to the permission's tile, so the page reads as a permission request before any text. */
function PermissionMark({ kind }: { kind: AskKind }) {
  const { name, symbol } = PERMISSION_COPY[kind];
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={`${name} permission`} style={styles.mark}>
      <Image source={APP_ICON} style={styles.tile} />
      <View style={styles.link}>
        {[0, 1, 2].map((dot) => (
          <View key={dot} style={styles.dot} />
        ))}
      </View>
      <View style={[styles.tile, styles.permission]}>
        <Image source={`sf:${symbol}`} tintColor={Gallery.surface} style={styles.symbol} />
      </View>
    </View>
  );
}

/** What the access does, then where it stops, on one gray card. */
function PermissionReasons({ kind }: { kind: AskKind }) {
  const { use, limit } = PERMISSION_COPY[kind];
  return (
    <View style={styles.reasons}>
      <Reason symbol={use.symbol}>{use.text}</Reason>
      <Reason symbol="hand.raised.fill">{limit}</Reason>
    </View>
  );
}

function Reason({ symbol, children }: { symbol: string; children: string }) {
  return (
    <View style={styles.reason}>
      <Image source={`sf:${symbol}`} tintColor={Gallery.accent} accessible={false} style={styles.reasonSymbol} />
      <ThemedText themeColor="textSecondary" style={styles.reasonText}>
        {children}
      </ThemedText>
    </View>
  );
}

const TILE = 52;

const styles = StyleSheet.create({
  ask: { gap: Spacing.three },
  headline: { textAlign: "center" },
  mark: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Spacing.compact },
  // App-icon corners, so both tiles read as icons from the Home Screen and Settings.
  tile: { width: TILE, height: TILE, borderRadius: Radius.card, borderCurve: "continuous", overflow: "hidden" },
  permission: { backgroundColor: Gallery.accent, alignItems: "center", justifyContent: "center" },
  symbol: { width: 28, height: 28 },
  link: { flexDirection: "row", gap: Spacing.one },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: Gallery.controlBorder },
  reasons: { gap: Spacing.compact, padding: Spacing.three, borderRadius: Radius.card, backgroundColor: Gallery.fill },
  reason: { flexDirection: "row", gap: Spacing.compact, alignItems: "flex-start" },
  reasonSymbol: { width: 20, height: 20, marginTop: 2 },
  reasonText: { flex: 1 },
});
