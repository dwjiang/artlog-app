import { useEffect, useState } from 'react';
import { Keyboard, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText as Text } from '@/components/themed-text';
import { Gallery } from '@/constants/theme';
import { GalleryButton } from '../collection/gallery-button';

export function VisitActionBar({ pendingPrivate, changingVisibility, sharingBusy, onSave }: {
  pendingPrivate: boolean; changingVisibility: boolean; sharingBusy: boolean; onSave: () => void;
}) {
  const { bottom } = useSafeAreaInsets();
  const [keyboardVisible, setKeyboardVisible] = useState(() => Keyboard.isVisible());
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  if (keyboardVisible) return null;
  return <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: Math.max(bottom, 12), gap: 8, backgroundColor: Gallery.paper }}>
    <GalleryButton label="Prepare to share" variant="filled" fullWidth disabled={changingVisibility || sharingBusy} onPress={onSave} />
    <Text style={{ fontSize: 12, lineHeight: 18, color: Gallery.muted, textAlign: 'center' }}>{pendingPrivate ? 'Privacy change waiting to sync' : 'You choose what to share before anything is published.'}</Text>
  </View>;
}
