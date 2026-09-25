import { Image } from "expo-image";
import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { SavedWorkImage } from "@/components/collection/saved-work-image";
import { LoadingRing } from "@/components/loading-ring";
import { ListSkeleton, VisitSkeleton } from "@/components/loading-skeleton";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Typography } from "@/constants/theme";
import type { SavedWork } from "@/db/schema";
import { cropSyncing } from "@/lib/account/photo-sync";

export function VisitMessage({
  children,
  loading,
  skeleton,
  action,
  onAction,
}: {
  children: ReactNode;
  loading?: boolean;
  skeleton?: "list" | "visit";
  action?: string;
  onAction?: () => void;
}) {
  if (loading && skeleton) {
    return skeleton === "visit" ? (
      <VisitSkeleton label={typeof children === "string" ? children : "Loading visit…"} />
    ) : (
      <ListSkeleton label={typeof children === "string" ? children : "Loading visits…"} rows={3} />
    );
  }
  return (
    <View style={visitStyles.section}>
      {loading && (
        <LoadingRing
          accessibilityLabel={typeof children === "string" ? children : "Loading visits"}
          color={Gallery.accent}
        />
      )}
      {!loading && <Text style={visitStyles.body}>{children}</Text>}
      {action && onAction && <GalleryButton label={action} onPress={onAction} />}
    </View>
  );
}
export function VisitPage({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
      style={visitStyles.page}
      contentContainerStyle={visitStyles.content}
    >
      {children}
    </ScrollView>
  );
}
export function VisitSymbol({
  name,
  size = 14,
  color = Gallery.muted,
}: {
  name: string;
  size?: number;
  color?: string;
}) {
  return <Image source={`sf:${name}`} tintColor={color} style={{ width: size, height: size }} />;
}
export function VisitPrivacyNote() {
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 6,
        paddingHorizontal: 20,
        paddingVertical: 20,
      }}
    >
      <VisitSymbol name="lock" size={12} color={Gallery.muted} />
      <Text style={[visitStyles.fine, { flex: 1 }]}>Your visits are private until you choose to share one.</Text>
    </View>
  );
}
export function ArtworkPreviews({
  works,
  size = 42,
  limit = 5,
  overflow = false,
}: {
  works: SavedWork[];
  size?: number;
  limit?: number;
  overflow?: boolean;
}) {
  const unique = [...new Map(works.map((work) => [`${work.owner}:${work.localId}`, work])).values()];
  const hidden = unique.length - limit;
  return (
    <View style={visitStyles.previews}>
      {unique.slice(0, limit).map((work) => (
        <SavedWorkImage
          key={`${work.owner}:${work.localId}`}
          path={work.cropPath}
          syncing={cropSyncing(work)}
          title={work.title}
          contain
          style={{ width: size, height: size }}
        />
      ))}
      {overflow && hidden > 0 && (
        <View
          accessibilityLabel={`${hidden} more ${hidden === 1 ? "artwork" : "artworks"}`}
          style={[visitStyles.more, { height: size }]}
        >
          <Text style={visitStyles.moreLabel}>+{hidden}</Text>
        </View>
      )}
    </View>
  );
}
export const visitStyles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Gallery.paper },
  content: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 32, gap: 12 },
  section: { padding: 20, gap: 12 },
  title: { ...Typography.display, color: Gallery.ink },
  heading: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "600",
    color: Gallery.ink,
  },
  body: { fontSize: 17, lineHeight: 25, color: Gallery.ink },
  caption: { fontSize: 13, lineHeight: 18, color: Gallery.muted },
  card: {
    padding: 16,
    gap: 10,
    backgroundColor: Gallery.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.card,
    borderColor: Gallery.softBorder,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  previews: { flexDirection: "row", gap: 5, flexWrap: "wrap" },
  more: {
    minWidth: 32,
    paddingHorizontal: 6,
    borderRadius: 7,
    backgroundColor: Gallery.fill,
    alignItems: "center",
    justifyContent: "center",
  },
  moreLabel: { fontSize: 13, color: Gallery.muted },
  eyebrow: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    color: Gallery.muted,
  },
  fine: { fontSize: 13, lineHeight: 18, color: Gallery.muted },
  sectionLabel: {
    flexDirection: "row",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: Gallery.separator,
    paddingTop: 15,
    paddingBottom: 8,
  },
  input: {
    color: Gallery.ink,
    backgroundColor: Gallery.surface,
    padding: 14,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Gallery.controlBorder,
    fontSize: 17,
    minHeight: 44,
  },
  reflection: { minHeight: 105, textAlignVertical: "top" },
  error: { fontSize: 15, lineHeight: 22, color: Gallery.destructive },
});
