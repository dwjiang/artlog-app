import { Image } from "expo-image";
import { useEffect, useRef, useState } from "react";
import { Modal, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GalleryButton } from "@/components/collection/gallery-button";
import { MotionPressable } from "@/components/motion-pressable";
import { PopInBadge } from "@/components/pop-on-turn-on";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Spacing, Typography } from "@/constants/theme";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { reportError } from "@/lib/observability";
import { AVATAR_IMAGES } from "@/lib/social/avatar-images";
import { chooseProfilePhoto, removeProfilePhotoDraft } from "@/lib/social/profile-photo";
import type { ProfilePicture } from "@/lib/social/profile-picture";
import { useHorizontalSafeAreaPadding, useSafeAreaWidth } from "@/lib/ui/safe-area";
import { AVATAR_GROUPS, AVATARS, type AvatarId, findAvatar } from "@/shared/social/avatars";

import { ProfileAvatar } from "./profile-avatar";

const COLUMNS = 4;
const GAP = Spacing.compact;

type Shown = { photoUrl?: string; avatar?: AvatarId };

export function ProfilePicturePicker({
  visible,
  name,
  shown,
  onCancel,
  onSave,
}: {
  visible: boolean;
  name?: string;
  /** The picture on screen now; a photo takes precedence over the painting. */
  shown: Shown;
  onCancel: () => void;
  /** Called only for a changed picture, and takes over a chosen photo's draft file. */
  onSave: (picture: ProfilePicture) => void;
}) {
  const reduced = useReducedMotion();
  return (
    <Modal
      visible={visible}
      animationType={reduced ? "fade" : "slide"}
      presentationStyle="pageSheet"
      onRequestClose={onCancel}
    >
      <PickerSheet name={name} shown={shown} onCancel={onCancel} onSave={onSave} />
    </Modal>
  );
}

function PickerSheet({
  name,
  shown,
  onCancel,
  onSave,
}: {
  name?: string;
  shown: Shown;
  onCancel: () => void;
  onSave: (picture: ProfilePicture) => void;
}) {
  const { fontScale } = useWindowDimensions();
  const width = useSafeAreaWidth();
  const largeText = fontScale > 1.4;
  const { bottom } = useSafeAreaInsets();
  const barPadding = useHorizontalSafeAreaPadding(styles.bar);
  const largeTitlePadding = useHorizontalSafeAreaPadding(styles.largeTitle);
  const contentPadding = useHorizontalSafeAreaPadding(styles.content);
  // Undefined keeps the photo already shown.
  const [selection, setSelection] = useState<ProfilePicture | undefined>(() =>
    shown.photoUrl || !shown.avatar ? undefined : { kind: "avatar", avatar: shown.avatar },
  );
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string>();
  const draft = useRef<string>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      removeProfilePhotoDraft(draft.current);
    };
  }, []);
  async function choosePhoto() {
    setChoosing(true);
    setError(undefined);
    try {
      const next = await chooseProfilePhoto();
      if (!mounted.current) {
        removeProfilePhotoDraft(next);
        return;
      }
      if (next) {
        removeProfilePhotoDraft(draft.current);
        draft.current = next;
        setSelection({ kind: "photo", uri: next });
      }
    } catch (cause) {
      reportError(cause, "profile.photo.choose");
      if (mounted.current) setError("This photo could not be opened. Try another image.");
    } finally {
      if (mounted.current) setChoosing(false);
    }
  }
  function save() {
    const unchanged =
      !selection || (selection.kind === "avatar" && !shown.photoUrl && selection.avatar === shown.avatar);
    if (unchanged) {
      onCancel();
      return;
    }
    if (selection.kind === "photo") draft.current = undefined;
    onSave(selection);
  }
  const preview =
    selection === undefined
      ? shown
      : selection.kind === "photo"
        ? { photoUrl: selection.uri, avatar: shown.avatar }
        : { avatar: selection.avatar };
  const work = selection?.kind === "avatar" ? findAvatar(selection.avatar) : undefined;
  const tile = Math.min(84, Math.floor((width - Spacing.content * 2 - GAP * (COLUMNS - 1)) / COLUMNS));
  const heading = (
    <Text accessibilityRole="header" style={styles.barTitle}>
      Profile picture
    </Text>
  );
  return (
    <View style={styles.sheet}>
      {largeText && <View style={[styles.largeTitle, largeTitlePadding]}>{heading}</View>}
      <View style={[styles.bar, barPadding]}>
        <GalleryButton label="Cancel" fullWidth={false} disabled={choosing} onPress={onCancel} />
        {!largeText && heading}
        <GalleryButton label="Save" fullWidth={false} disabled={choosing} onPress={save} />
      </View>
      <ScrollView contentContainerStyle={[styles.content, contentPadding, { paddingBottom: bottom + Spacing.four }]}>
        <View style={styles.preview}>
          <ProfileAvatar name={name} photoUrl={preview.photoUrl} avatar={preview.avatar} size={128} />
          <View style={styles.credit}>
            {work ? (
              <>
                <Text style={styles.creditTitle}>{work.title}</Text>
                <Text style={styles.creditByline}>
                  {work.artist}, {work.date}
                </Text>
              </>
            ) : (
              preview.photoUrl && <Text style={styles.creditByline}>Your photo</Text>
            )}
          </View>
          <GalleryButton
            label="Choose photo"
            busy={choosing}
            busyLabel="Opening photos…"
            onPress={() => {
              void choosePhoto();
            }}
          />
          {error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
        </View>
        {AVATAR_GROUPS.map((group) => (
          <View key={group} style={styles.group}>
            <Text accessibilityRole="header" style={styles.groupLabel}>
              {group}
            </Text>
            <View style={styles.grid}>
              {AVATARS.filter((avatar) => avatar.group === group).map((avatar) => {
                const selected = selection?.kind === "avatar" && selection.avatar === avatar.id;
                return (
                  <MotionPressable
                    key={avatar.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${avatar.title}, ${avatar.artist}`}
                    accessibilityState={{ selected }}
                    onPress={() => setSelection({ kind: "avatar", avatar: avatar.id })}
                    style={[
                      styles.tile,
                      { width: tile, height: tile, borderRadius: tile / 2 },
                      selected && styles.selected,
                    ]}
                  >
                    <Image
                      source={AVATAR_IMAGES[avatar.id]}
                      cachePolicy="memory"
                      accessible={false}
                      style={{ width: tile - 8, height: tile - 8, borderRadius: (tile - 8) / 2 }}
                    />
                    <PopInBadge on={selected} style={styles.check}>
                      <Image source="sf:checkmark" tintColor={Gallery.surface} style={styles.checkIcon} />
                    </PopInBadge>
                  </MotionPressable>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: Gallery.paper },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
    paddingHorizontal: Spacing.content,
    paddingTop: Spacing.two,
  },
  barTitle: { ...Typography.button, flexShrink: 1, textAlign: "center" },
  largeTitle: { paddingHorizontal: Spacing.content, paddingTop: Spacing.two },
  content: { paddingHorizontal: Spacing.content, gap: Spacing.four },
  preview: { alignItems: "center", gap: Spacing.two, paddingTop: Spacing.two },
  credit: { alignItems: "center", gap: Spacing.half },
  creditTitle: { ...Typography.section, textAlign: "center" },
  creditByline: { ...Typography.secondary, color: Gallery.muted, textAlign: "center" },
  error: { color: Gallery.destructive, textAlign: "center" },
  group: { gap: Spacing.compact },
  groupLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    color: Gallery.muted,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  tile: { alignItems: "center", justifyContent: "center", borderWidth: 2.5, borderColor: "transparent" },
  selected: { borderColor: Gallery.accent },
  check: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Gallery.accent,
    borderWidth: 2,
    borderColor: Gallery.paper,
  },
  checkIcon: { width: 11, height: 11 },
});
