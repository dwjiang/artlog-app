import { RNHostView } from '@expo/ui/swift-ui';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState } from 'react';
import { Image } from 'expo-image';
import { View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Gallery } from '@/constants/theme';

import { GroupedFooter, GroupedSection, NavigationRow } from '@/components/grouped-list';

const SOURCE_URL = 'https://github.com/dwjiang/artlog-app';
// Placeholder until terms exist; tracked in docs/todos.
const TERMS_URL = 'https://google.com';
const FEEDBACK_URL = `${SOURCE_URL}/issues/new`;
const ANTON_LICENSE_URL = 'https://github.com/google/fonts/blob/main/ofl/anton/OFL.txt';

export function AboutSection() {
  const [error, setError] = useState<string>();
  async function open(url: string) {
    setError(undefined);
    try { await Linking.openURL(url); }
    catch { setError("Couldn't open the link. Try again."); }
  }
  return <>
    <GroupedSection>
      <RNHostView matchContents><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 20, alignItems: 'center', paddingVertical: 24, backgroundColor: Gallery.paper }}>
        <Image source={require('../../../assets/images/icon.png')} accessible={false} style={{ width: 96, height: 96, borderRadius: 22 }} />
        <View style={{ flexShrink: 1, gap: 2 }}>
          <ThemedText variant="display" accessibilityRole="header">Artlog</ThemedText>
          <ThemedText variant="secondary" themeColor="textSecondary">Version {Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? 'Unknown'}</ThemedText>
        </View>
      </View></RNHostView>
    </GroupedSection>
    <GroupedSection footer={error ? <GroupedFooter tone="destructive">{error}</GroupedFooter> : undefined}>
      <NavigationRow label="Privacy policy" onPress={() => router.push({ pathname: '/settings-detail', params: { section: 'privacy' } })} />
      <NavigationRow label="Terms" onPress={() => { void open(TERMS_URL); }} />
      <NavigationRow label="Send feedback" onPress={() => { void open(FEEDBACK_URL); }} />
    </GroupedSection>
    <GroupedSection title="Credits" footer={<GroupedFooter>Anton by Vernon Adams. Copyright 2020 The Anton Project Authors. Licensed under the SIL Open Font License, Version 1.1.</GroupedFooter>}>
      <NavigationRow label="Source code" onPress={() => { void open(SOURCE_URL); }} />
      <NavigationRow label="Anton font and license" onPress={() => { void open(ANTON_LICENSE_URL); }} />
    </GroupedSection>
  </>;
}
