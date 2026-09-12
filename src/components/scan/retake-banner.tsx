import { Image } from 'expo-image';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';

export const RETAKE_DISMISS_MS = 4000;

export type RetakeBannerProps = { message: string; onRetake: () => void };

/** The triage verdict of the last capture; "Retake" or four seconds hands the viewfinder back. */
export function RetakeBanner({ message, onRetake }: RetakeBannerProps) {
  // The caller recreates `onRetake` on every render; the timer must only restart for a new message.
  const retake = useRef(onRetake);
  useEffect(() => { retake.current = onRetake; }, [onRetake]);
  useEffect(() => {
    const timer = setTimeout(() => retake.current(), RETAKE_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <View style={styles.banner}>
      <Image source="sf:exclamationmark.triangle.fill" style={styles.icon} tintColor={Colors.light.warning} />
      <ThemedText accessibilityRole="alert" type="smallBold" themeColor="overlayText" style={styles.message}>{message}</ThemedText>
      <Pressable accessibilityRole="button" onPress={onRetake} hitSlop={Spacing.two} style={({ pressed }) => pressed && styles.pressed}>
        <ThemedText type="smallBold" themeColor="accent">Retake</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.two, alignSelf: 'stretch',
    backgroundColor: Colors.light.overlayScrim, borderRadius: Spacing.three, paddingVertical: Spacing.two, paddingHorizontal: Spacing.three,
  },
  icon: { width: 18, height: 18 },
  message: { flex: 1 },
  pressed: { opacity: 0.6 },
});
