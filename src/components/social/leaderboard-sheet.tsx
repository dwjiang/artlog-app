import { BottomSheet, Host, RNHostView, ScrollView, VStack } from '@expo/ui/swift-ui';
import { presentationBackground, presentationDetents, presentationDragIndicator } from '@expo/ui/swift-ui/modifiers';
import { useState, type ReactNode } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { Gallery } from '@/constants/theme';
import { GalleryButton } from '../collection/gallery-button';

export function LeaderboardSheet({ title, children, onDismiss, dismissLabel = 'Done', dismissDisabled = false, isPresented = true }: {
  title: string; children: ReactNode; onDismiss: () => void; dismissLabel?: string; dismissDisabled?: boolean; isPresented?: boolean;
}) {
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState(true);
  return <Host style={{ position: 'absolute' }} pointerEvents="none"><BottomSheet isPresented={isPresented && open}
    onIsPresentedChange={setOpen} onDismiss={onDismiss}>
    <VStack spacing={0} modifiers={[presentationDetents(['large']), presentationDragIndicator('visible'), presentationBackground(Gallery.paper)]}>
      <RNHostView matchContents>
        <View style={{ width, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8 }}>
          <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '600', color: Gallery.ink }}>{title}</Text>
          <GalleryButton label={dismissLabel} disabled={dismissDisabled} onPress={() => setOpen(false)} />
        </View>
      </RNHostView>
      <ScrollView><RNHostView matchContents>
        <View style={{ width, padding: 20, paddingBottom: 40, gap: 22 }}>{children}</View>
      </RNHostView></ScrollView>
    </VStack>
  </BottomSheet></Host>;
}
