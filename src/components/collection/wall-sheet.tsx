import { ThemedText as Text } from '@/components/themed-text';
import { BottomSheet, RNHostView } from '@expo/ui';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Gallery } from '@/constants/theme';
import { GalleryButton } from './gallery-button';

export function WallSheet({ title, children, onDismiss, tall = false, dismissLabel = 'Done' }: {
  title: string; children: ReactNode; onDismiss: () => void; tall?: boolean; dismissLabel?: string;
}) {
  return <BottomSheet isPresented onDismiss={onDismiss} snapPoints={tall ? ['full'] : [{ height: 300 }, 'full']}
    contentPadding={0} containerColor={Gallery.paper}>
    {/* Presented content needs its own React Native touch and measurement root. */}
    <RNHostView>
      <View style={{ flex: 1 }}>
        <View style={styles.sheetHeader}>
          <Text variant="section" accessibilityRole="header" style={styles.sheetTitle}>{title}</Text>
          <GalleryButton label={dismissLabel} fullWidth={false} onPress={onDismiss} />
        </View>
        {children}
      </View>
    </RNHostView>
  </BottomSheet>;
}

const styles = {
  sheetHeader: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4, flexDirection: 'row' as const,
    justifyContent: 'space-between' as const, alignItems: 'center' as const, borderBottomWidth: 0.5, borderColor: Gallery.separator },
  sheetTitle: { flex: 1, color: Gallery.ink },
};
