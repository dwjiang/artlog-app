import { useEffect, useState } from 'react';
import { Keyboard, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText as Text } from '@/components/themed-text';
import { Gallery, Spacing, Typography } from '@/constants/theme';
import { GalleryButton } from '../collection/gallery-button';
import { VisitSymbol } from './visit-ui';

export function VisitActionBar({ isPublic, pendingPrivate, changingVisibility, sharingBusy, onChangeVisibility, onSave }: {
  isPublic: boolean;
  pendingPrivate: boolean;
  changingVisibility: boolean;
  sharingBusy: boolean;
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
      disabled={changingVisibility || sharingBusy} busy={changingVisibility} onPress={onChangeVisibility} />
    {isPublic ? <View style={{ width: fontScale >= 1.5 ? '100%' : '48%' }}>
      <GalleryButton label="Prepare to share" variant="filled" fullWidth disabled={changingVisibility || sharingBusy} onPress={onSave} />
    </View> : <View style={styles.status}>
      {!pendingPrivate && <VisitSymbol name="checkmark" size={17} />}
      <Text style={styles.statusText}>{pendingPrivate ? 'Waiting to sync' : 'Saved privately'}</Text>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
    columnGap: Spacing.compact, rowGap: Spacing.one, paddingHorizontal: Spacing.content, paddingTop: Spacing.two,
    backgroundColor: Gallery.surface, borderTopWidth: StyleSheet.hairlineWidth, borderColor: Gallery.separator },
  status: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44, flexShrink: 1 },
  statusText: { ...Typography.secondary, color: Gallery.muted, flexShrink: 1 },
});
