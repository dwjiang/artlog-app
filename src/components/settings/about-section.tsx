import { useQuery } from 'convex/react';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { View } from 'react-native';

import { api } from '../../../convex/_generated/api';
import model from '../../../shared/model/model-version.json';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { SettingsRow } from './settings-row';

const SOURCE_URL = 'https://github.com/dwjiang/artlog-app';

export function AboutSection() {
  const health = useQuery(api.health.ping);
  const [error, setError] = useState<string>();
  async function open(url: string) {
    setError(undefined);
    try { await Linking.openURL(url); }
    catch { setError("Couldn't open the link. Try again."); }
  }
  return <View style={{ gap: Spacing.two }}>
    <ThemedText>Artlog · {Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? 'Unknown version'}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">Model: {model.modelVersion}</ThemedText>
    <ThemedText themeColor="textSecondary">{health ? 'Backend: connected' : 'Backend: connecting…'}</ThemedText>
    <SettingsRow title="Source code" detail={SOURCE_URL} onPress={() => { void open(SOURCE_URL); }} />
    {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
  </View>;
}
