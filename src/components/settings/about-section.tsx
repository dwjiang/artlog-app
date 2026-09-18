import { RNHostView, Section } from '@expo/ui/swift-ui';
import { useQuery } from 'convex/react';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { listRowBackground } from '@expo/ui/swift-ui/modifiers';
import { useState } from 'react';
import { Image } from 'expo-image';
import { View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Gallery } from '@/constants/theme';

import { api } from '../../../convex/_generated/api';
import model from '../../../shared/model/model-version.json';
import { ActionRow, GroupedFooter, ValueRow } from '@/components/grouped-list';

const SOURCE_URL = 'https://github.com/dwjiang/artlog-app';

export function AboutSection() {
  const health = useQuery(api.health.ping);
  const [error, setError] = useState<string>();
  async function open(url: string) {
    setError(undefined);
    try { await Linking.openURL(url); }
    catch { setError("Couldn't open the link. Try again."); }
  }
  return <>
    <Section modifiers={[listRowBackground(Gallery.paper)]}>
      <RNHostView matchContents><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, alignItems: 'center', paddingVertical: 16, backgroundColor: Gallery.paper }}>
        <Image source={require('../../../assets/images/icon.png')} accessible={false} style={{ width: 72, height: 72, borderRadius: 16 }} />
        <View style={{ flexShrink: 1, gap: 4 }}>
          <ThemedText variant="display" accessibilityRole="header">Artlog</ThemedText>
          <ThemedText variant="metadata" themeColor="textSecondary">Version {Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? 'Unknown'}</ThemedText>
        </View>
      </View></RNHostView>
    </Section>
    <Section>
      <ValueRow label="Model" value={model.modelVersion} />
      <ValueRow label="Backend" value={health ? 'Connected' : 'Connecting…'} />
    </Section>
    <Section footer={error ? <GroupedFooter tone="destructive">{error}</GroupedFooter> : undefined}>
      <ActionRow label="Source code" icon="chevron.left.forwardslash.chevron.right" onPress={() => { void open(SOURCE_URL); }} />
    </Section>
    <Section title="Credits" footer={<GroupedFooter>Anton by Vernon Adams. Copyright 2020 The Anton Project Authors. Licensed under the SIL Open Font License, Version 1.1.</GroupedFooter>}>
      <ActionRow label="Anton font and license" icon="textformat" onPress={() => { void open('https://github.com/google/fonts/blob/main/ofl/anton/OFL.txt'); }} />
    </Section>
  </>;
}
