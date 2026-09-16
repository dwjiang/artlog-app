import { BottomSheet, RNHostView } from '@expo/ui';
import type { ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Gallery } from '@/constants/theme';
import { GalleryButton } from '../collection/gallery-button';

export function LeaderboardSheet({ title, children, onDismiss, dismissLabel = 'Done' }: {
  title: string; children: ReactNode; onDismiss: () => void; dismissLabel?: string;
}) {
  return <BottomSheet isPresented onDismiss={onDismiss} snapPoints={['full']} contentPadding={0} containerColor={Gallery.paper}>
    <RNHostView>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8 }}>
          <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '600', color: Gallery.ink }}>{title}</Text>
          <GalleryButton label={dismissLabel} onPress={onDismiss} />
        </View>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 22 }}>{children}</ScrollView>
      </View>
    </RNHostView>
  </BottomSheet>;
}
