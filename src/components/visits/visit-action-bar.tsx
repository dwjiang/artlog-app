import { useEffect, useState } from 'react';
import { Keyboard, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText as Text } from '@/components/themed-text';
import { Gallery, Spacing, Typography } from '@/constants/theme';
import { GalleryButton } from '../collection/gallery-button';

export function VisitActionBar({ isPublic, pendingPrivate, changingVisibility, sharingBusy, saving, onChangeVisibility, onSave }: {
  isPublic: boolean;
  pendingPrivate: boolean;
  changingVisibility: boolean;
  sharingBusy: boolean;
  saving: boolean;
  onChangeVisibility: () => void;
  onSave: () => void;
}) {
  const { bottom } = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const [keyboardVisible, setKeyboardVisible] = useState(() => Keyboard.isVisible());
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  if (keyboardVisible) return null;
  const visibility = isPublic ? 'Public' : 'Private';
  return <View style={[styles.bar, { paddingBottom: Math.max(bottom, Spacing.two) }]}>
    <GalleryButton label={visibility} icon={isPublic ? 'globe' : 'lock'} tone="ink" fullWidth={false}
      accessibilityLabel={`${visibility} visit. ${isPublic ? 'Make private.' : 'Make public.'}`}
      disabled={saving || changingVisibility || sharingBusy} busy={changingVisibility} onPress={onChangeVisibility} />
    <View style={{ width: fontScale >= 1.5 ? '100%' : '48%', gap: Spacing.one }}>
      <GalleryButton label="Save" variant="filled" fullWidth busy={saving} busyLabel="Saving…" disabled={changingVisibility || (isPublic && sharingBusy)} onPress={onSave} />
      {pendingPrivate && <Text style={styles.statusText}>Waiting to sync</Text>}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
    columnGap: Spacing.compact, rowGap: Spacing.one, paddingHorizontal: Spacing.content, paddingTop: Spacing.two,
    backgroundColor: Gallery.surface, borderTopWidth: StyleSheet.hairlineWidth, borderColor: Gallery.separator },
  statusText: { ...Typography.secondary, color: Gallery.muted, flexShrink: 1 },
});
